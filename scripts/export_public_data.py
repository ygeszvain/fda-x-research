#!/usr/bin/env python3
"""Export an explicit public field allowlist from the latest completed snapshot."""
import argparse
import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from dotenv import load_dotenv

METRICS = ['impression_count', 'like_count', 'repost_count', 'reply_count', 'quote_count', 'bookmark_count']
ACCOUNTS = ['FDA', 'FDADrugs', 'FDAFood', 'FDADevices', 'FDATobacco', 'FDARecalls']
TZ = ZoneInfo('America/Chicago')


def day(value):
    return value.astimezone(TZ).date().isoformat() if isinstance(value, datetime) else value.isoformat()


def node_id(value, root_ids):
    return value if value in root_ids else 'n_' + hashlib.sha256(value.encode()).hexdigest()[:16]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', type=Path, default=Path.home()/'.config/fda-x-daily.env')
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'data/dashboard.json')
    args = parser.parse_args()
    load_dotenv(args.env_file, override=False)
    connection = psycopg.connect(
        host=os.getenv('PGHOST', os.getenv('POSTGRES_HOST', 'localhost')),
        port=int(os.getenv('PGPORT', os.getenv('POSTGRES_PORT', '5432'))),
        dbname=os.getenv('PGDATABASE', os.getenv('POSTGRES_DB', 'fda_x_research')),
        user=os.getenv('PGUSER', os.getenv('POSTGRES_USER', 'fda_researcher')),
        password=os.getenv('PGPASSWORD', os.getenv('POSTGRES_PASSWORD')),
        row_factory=dict_row, application_name='fda_x_public_export',
    )
    with connection, connection.transaction():
        connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        run = connection.execute("SELECT scheduled_for_date, completed_at FROM fda_x_meta.daily_snapshot_runs WHERE status='completed' ORDER BY scheduled_for_date DESC, completed_at DESC LIMIT 1").fetchone()
        if not run:
            raise RuntimeError('No completed collection exists.')
        latest = run['scheduled_for_date']
        audit=connection.execute("SELECT count(*) AS rows, COALESCE(sum(unattempted_entity_count),0) AS unattempted FROM fda_x_derived.daily_collection_integrity WHERE collection_date=%s",(latest,)).fetchone()
        if not audit['rows'] or audit['unattempted']:
            raise RuntimeError('The latest date has not passed collection attempt coverage.')
        table = 'snapshot_' + latest.strftime('%Y_%m_%d')
        fields = ['observation_date_chicago','mechanism','diffusion_level','root_post_id','root_account_handle',
                  'event_post_id','parent_post_id','event_created_at','observed_at','lookup_status',
                  'root_created_at','root_first_seen_at','root_theme_primary','root_message_function',
                  'root_media_types','root_hashtag_count','root_url_count','root_account_followers_count',
                  'root_crisis_phase','root_tracking_status'] + METRICS
        rows = connection.execute(sql.SQL('SELECT {} FROM {}.{} ORDER BY observation_date_chicago,root_post_id,event_post_id').format(
            sql.SQL(',').join(map(sql.Identifier, fields)), sql.Identifier('fda_x_daily_snapshots'), sql.Identifier(table))).fetchall()
        root_ids = {r['root_post_id'] for r in rows}
        if not root_ids:
            raise RuntimeError('The daily snapshot contains no cohort roots.')
        if any(r['root_account_handle'] not in ACCOUNTS for r in rows):
            raise RuntimeError('Unexpected account outside the six-account study.')
        summaries = {r['content_id']:r['one_sentence_summary'] for r in connection.execute(
            "SELECT content_id,one_sentence_summary FROM fda_x_meta.content_theme_coding WHERE content_type='primary_post' AND coding_status='coded' AND content_id=ANY(%s)",(list(root_ids),)).fetchall()}
        edges = connection.execute("""SELECT event_post_id,root_post_id,parent_post_id,event_type,diffusion_level,
            event_created_at,first_seen_at,parent_link_payload_verified
            FROM fda_x_derived.diffusion_edges WHERE root_post_id=ANY(%s)
            AND (first_seen_at AT TIME ZONE 'America/Chicago')::date <= %s
            ORDER BY event_created_at,event_post_id""", (list(root_ids),latest)).fetchall()
        integrity = connection.execute("""SELECT collection_date,mechanism,expected_entity_count,attempted_entity_count,
            observed_entity_count,missing_entity_count,attempt_coverage_pct,coverage_pct
            FROM fda_x_derived.daily_collection_integrity WHERE collection_date<=%s ORDER BY collection_date,mechanism""",(latest,)).fetchall()
    roots = {}
    observations = []
    grains = set()
    for r in rows:
        root = r['root_post_id']
        date = day(r['observation_date_chicago'])
        grain = (root,r['event_post_id'],r['mechanism'],date)
        if grain in grains:
            raise RuntimeError('Duplicate entity/day in public source.')
        grains.add(grain)
        if root not in roots or r['mechanism']=='original_post':
            roots[root] = dict(id=root,account=r['root_account_handle'],created=day(r['root_created_at']),
                firstSeen=day(r['root_first_seen_at']),summary=summaries.get(root) or 'FDA public communication',
                theme=r['root_theme_primary'] or 'Pending coding',messageFunction=r['root_message_function'],
                media=r['root_media_types'],hashtags=r['root_hashtag_count'],links=r['root_url_count'],
                crisisPhase=r['root_crisis_phase'],tracking=r['root_tracking_status'])
        observations.append(dict(root=root,node=node_id(r['event_post_id'],root_ids),date=date,
            mechanism=r['mechanism'],status=r['lookup_status'],metrics=[r[m] for m in METRICS]))
    nodes=[]
    for e in edges:
        if not e['parent_link_payload_verified']:
            continue
        mechanism = {'quote':'quote_post','quote_repost':'quote_repost','repost':'level_1_repost' if e['diffusion_level']==1 else 'repost_descendant'}[e['event_type']]
        nodes.append(dict(id=node_id(e['event_post_id'],root_ids),parent=node_id(e['parent_post_id'],root_ids) if e['parent_post_id'] else None,
            root=e['root_post_id'],mechanism=mechanism,level=e['diffusion_level'],created=day(e['event_created_at']),firstSeen=day(e['first_seen_at'])))
    dates = sorted({r['date'] for r in observations})
    data=dict(version=1,timezone='America/Chicago',asOf=latest.isoformat(),collectionCompletedAt=run['completed_at'].isoformat(),
        sourceSnapshot=f'fda_x_daily_snapshots.{table}',accounts=ACCOUNTS,metrics=METRICS,dates=dates,
        roots=sorted(roots.values(), key=lambda r:(r['created'],r['id'])),nodes=nodes,observations=observations,
        integrity=[dict(date=day(r['collection_date']),mechanism=r['mechanism'],expected=r['expected_entity_count'],
            attempted=r['attempted_entity_count'],returned=r['observed_entity_count'],missing=r['missing_entity_count']) for r in integrity])
    serialized=json.dumps(data,ensure_ascii=True,allow_nan=False,separators=(',',':'))+'\n'
    # No raw payloads, private configuration, downstream text, or downstream handles are selected.
    for forbidden in ['api_post_payload','event_author_username','source_text_sha256','postgresql://','npg_','Bearer ']:
        if forbidden in serialized:
            raise RuntimeError('Public export allowlist check failed.')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    if not args.output.exists() or args.output.read_text()!=serialized:
        temporary=args.output.with_suffix('.json.tmp')
        temporary.write_text(serialized)
        temporary.replace(args.output)
    print(json.dumps(dict(asOf=data['asOf'],roots=len(roots),edges=len(nodes),observations=len(observations),dates=len(dates),bytes=len(serialized))))


if __name__=='__main__':
    main()
