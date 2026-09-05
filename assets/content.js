"use strict";

const categoryFields = {
  theme: "Theme",
  crisisRelevance: "Crisis relevance",
  urgencyLevel: "Urgency",
};
const contentPalette = [
  "#147d65",
  "#1684a8",
  "#c44e87",
  "#91662d",
  "#6a60b7",
  "#536d7d",
  "#a14435",
  "#598331",
  "#3b68ad",
  "#a26d94",
  "#798386",
];
const categoryName = (item, field) => {
  const value = item?.[field];
  if (value == null || value === "") return "Pending / unavailable";
  if (value === "none") return "None coded";
  return String(value)
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
};
const contentValue = (v) => (v == null ? "Unavailable" : fmt(+v.toFixed(2)));
const contentKey = (o) => `${o.node}|${o.date}`;
const average = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

function contentGroups(items, field, limit = 10) {
  const counts = new Map();
  items.forEach((item) => {
    const name = categoryName(item, field);
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  const ordered = [...counts].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const protectedNames = [
    "Pending / unavailable",
    "Pending coding",
    "None coded",
  ];
  const protectedPresent = protectedNames.filter((name) => counts.has(name));
  const names = ordered
    .filter(([name]) => !protectedNames.includes(name))
    .slice(0, Math.max(0, limit - protectedPresent.length))
    .map(([name]) => name)
    .concat(protectedPresent);
  const retained = new Set(names),
    remaining = ordered.length - names.length;
  const other = `Other categories (${remaining})`;
  if (remaining) names.push(other);
  return {
    names,
    group: (item) => {
      const name = categoryName(item, field);
      return retained.has(name) ? name : other;
    },
    note: remaining
      ? ` Up to ${limit} categories, ranked by post count with pending and none retained; ${remaining} smaller categories are pooled as Other.`
      : "",
  };
}

// Authored content is counted once even when it is reachable from multiple roots.
function buildContentModel(ctx, field, scope, metric, cutoff) {
  const items =
    scope === "original_post"
      ? ctx.roots
      : [
          ...new Map(
            ctx.nodes
              .filter((n) => n.mechanism === "quote_post")
              .map((n) => [n.id, n]),
          ).values(),
        ];
  const groups = contentGroups(items, field);
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows = [
    ...new Map(
      ctx.obs
        .filter(
          (o) =>
            o.mechanism === scope &&
            o.status === "returned" &&
            byId.has(o.node),
        )
        .map((o) => [contentKey(o), o]),
    ).values(),
  ];
  const index = new Map(rows.map((o) => [contentKey(o), o]));
  const categories = groups.names.map((name) => {
    const members = items.filter((item) => groups.group(item) === name);
    const ids = new Set(members.map((item) => item.id));
    const daily = ctx.dates.map((date) => {
      const previous = new Date(Date.parse(date) - 86400000)
        .toISOString()
        .slice(0, 10);
      const current = rows.filter((o) => o.date === date && ids.has(o.node));
      const values = current
        .map((o) => o.metrics[metric])
        .filter((v) => v != null);
      const changes = current.flatMap((o) => {
        const prior = index.get(`${o.node}|${previous}`);
        return prior?.metrics[metric] != null && o.metrics[metric] != null
          ? [o.metrics[metric] - prior.metrics[metric]]
          : [];
      });
      return {
        date,
        mean: average(values),
        median: median(values),
        available: values.length,
        eligible: members.filter((item) => item.firstSeen <= date).length,
        change: average(changes),
        matched: changes.length,
      };
    });
    return {
      name,
      count: members.length,
      daily,
      latest: daily.find((d) => d.date === cutoff),
    };
  });
  return { items, groups, categories };
}

function categoryBars(id, names, series, formatter) {
  const small = $(id).clientWidth < 450;
  return chart(id, {
    color: contentPalette,
    grid: { left: small ? 118 : 200, right: 40, top: 40, bottom: 28 },
    legend:
      series.length > 1
        ? {
            type: "scroll",
            top: 0,
            textStyle: { fontSize: 10 },
            itemWidth: 10,
            itemHeight: 8,
          }
        : { show: false },
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter,
      extraCssText: "max-width:290px;white-space:normal",
    },
    xAxis: {
      type: "value",
      axisLabel: { fontSize: 10, formatter: short },
      splitLine: { lineStyle: { color: "#eef1f3" } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: names,
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        width: small ? 108 : 188,
        overflow: "truncate",
        fontSize: 10,
        color: "#53636c",
      },
    },
    series: series.map((s) => ({ type: "bar", barMaxWidth: 19, ...s })),
    graphic: names.length
      ? []
      : [
          {
            type: "text",
            left: "center",
            top: "middle",
            style: {
              text: "No posts match these filters",
              fill: "#68747c",
              fontSize: 12,
            },
          },
        ],
  });
}

function categoryLines(id, dates, categories, key) {
  chart(
    id,
    base(dates, {
      color: contentPalette,
      tooltip: {
        trigger: "axis",
        confine: true,
        extraCssText: "max-width:310px;white-space:normal",
        formatter: (params) => {
          if (!params.length) return "";
          const i = params[0].dataIndex;
          return (
            `${escape(labelDate(dates[i]))}<br>` +
            params
              .map((p) => {
                const point = categories.find((c) => c.name === p.seriesName)
                  .daily[i];
                const count =
                  key === "change"
                    ? `${point.matched} matched posts`
                    : `${point.available}/${point.eligible} posts available`;
                return `${p.marker}${escape(p.seriesName)}: <b>${contentValue(point[key])}</b> (${count})`;
              })
              .join("<br>")
          );
        },
      },
      series: categories.map((c) => ({
        name: c.name,
        type: "line",
        symbol: "circle",
        symbolSize: 5,
        connectNulls: false,
        lineStyle: { width: 2 },
        data: c.daily.map((d) => d[key]),
      })),
      graphic: categories.length
        ? []
        : [
            {
              type: "text",
              left: "center",
              top: "middle",
              style: { text: "No posts match these filters", fill: "#68747c" },
            },
          ],
    }),
  );
}

function renderCategoryDiffusion(ctx, field) {
  const rootGroups = contentGroups(ctx.roots, field);
  const rootMap = new Map(ctx.roots.map((r) => [r.id, r]));
  const edges = [
    ...new Map(
      ctx.nodes.map((n) => [`${n.root}|${n.id}|${n.mechanism}`, n]),
    ).values(),
  ];
  const counts = rootGroups.names.map((name) => {
    const roots = ctx.roots.filter((r) => rootGroups.group(r) === name);
    const ids = new Set(roots.map((r) => r.id));
    return {
      name,
      roots: roots.length,
      mechanisms: Object.fromEntries(
        mechanisms.map((m) => [
          m,
          edges.filter((n) => ids.has(n.root) && n.mechanism === m).length,
        ]),
      ),
    };
  });
  categoryBars(
    "category-diffusion",
    rootGroups.names,
    mechanisms.map((m) => ({
      name: mechanismLabel[m],
      stack: "events",
      itemStyle: { color: mechanismColor[m] },
      data: counts.map((c) => c.mechanisms[m] / c.roots),
    })),
    (params) => {
      if (!params.length) return "";
      const c = counts[params[0].dataIndex];
      return (
        `${escape(c.name)}<br>${c.roots} originals<br>` +
        mechanisms
          .map(
            (m) =>
              `${escape(mechanismLabel[m])}: <b>${fmt(c.mechanisms[m])}</b> events (${contentValue(c.mechanisms[m] / c.roots)} per original)`,
          )
          .join("<br>")
      );
    },
  );

  const quotes = edges.filter((n) => n.mechanism === "quote_post");
  const quoteGroups = contentGroups(quotes, field, 8);
  const rootQuoteGroups = contentGroups(
    quotes.map((n) => rootMap.get(n.root)),
    field,
    8,
  );
  const cells = new Map();
  quotes.forEach((n) => {
    const x = quoteGroups.names.indexOf(quoteGroups.group(n));
    const y = rootQuoteGroups.names.indexOf(
      rootQuoteGroups.group(rootMap.get(n.root)),
    );
    const key = `${x}|${y}`;
    cells.set(key, (cells.get(key) || 0) + 1);
  });
  const points = [...cells].map(([key, count]) => [
    ...key.split("|").map(Number),
    count,
  ]);
  const small = $("category-flow").clientWidth < 450;
  chart("category-flow", {
    grid: { left: small ? 105 : 168, right: 15, top: 14, bottom: 155 },
    tooltip: {
      confine: true,
      extraCssText: "max-width:290px;white-space:normal",
      formatter: (p) =>
        `Original: ${escape(rootQuoteGroups.names[p.value[1]])}<br>Quote: ${escape(quoteGroups.names[p.value[0]])}<br><b>${fmt(p.value[2])}</b> observed quotes`,
    },
    xAxis: {
      type: "category",
      data: quoteGroups.names,
      splitArea: { show: true },
      axisLabel: {
        interval: 0,
        rotate: 45,
        width: 110,
        overflow: "truncate",
        fontSize: 9,
      },
      axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rootQuoteGroups.names,
      axisLabel: { width: small ? 96 : 156, overflow: "truncate", fontSize: 9 },
      axisTick: { show: false },
    },
    visualMap: {
      min: 0,
      max: Math.max(1, ...points.map((p) => p[2])),
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 10,
      itemHeight: 90,
      text: ["More", "Fewer"],
      inRange: { color: ["#eff4f4", "#8fc6c0", "#147d65"] },
      textStyle: { fontSize: 10 },
    },
    series: [
      {
        type: "heatmap",
        data: points,
        label: { show: !small, fontSize: 10 },
        itemStyle: { borderColor: "white", borderWidth: 2 },
      },
    ],
    graphic: points.length
      ? []
      : [
          {
            type: "text",
            left: "center",
            top: "middle",
            style: {
              text: "No observed quotes in this selection",
              fill: "#68747c",
              fontSize: 11,
            },
          },
        ],
  });
}

function renderContent(ctx) {
  const field = $("content-dimension").value,
    scope = $("content-scope").value;
  const metric = Number($("content-metric").value),
    name = labels[metric].toLowerCase();
  const model = buildContentModel(ctx, field, scope, metric, state.date);
  const { categories, groups, items } = model;
  const quoted = scope === "quote_post";
  $("content-context").textContent =
    `${fmt(items.length)} distinct ${quoted ? "quote posts, categorized by their own content" : "FDA originals"} through ${labelDate(state.date)}. Grouping: ${categoryFields[field]}.${groups.note} Categories use the current coding; uncoded values remain separate.`;
  $("category-level-title").textContent =
    `Median ${name} per post on ${labelDate(state.date)}`;
  $("category-growth-title").textContent = `Mean cumulative ${name} per post`;
  $("category-change-title").textContent = `Mean daily change in ${name}`;
  categoryBars(
    "category-count",
    groups.names,
    [
      {
        data: categories.map((c, i) => ({
          value: c.count,
          itemStyle: { color: contentPalette[i] },
        })),
        label: { show: true, position: "right", fontSize: 10 },
      },
    ],
    (params) => {
      const c = categories[params[0]?.dataIndex];
      return c
        ? `${escape(c.name)}<br><b>${fmt(c.count)}</b> distinct ${quoted ? "quotes" : "originals"}`
        : "";
    },
  );
  categoryBars(
    "category-level",
    groups.names,
    [
      {
        data: categories.map((c, i) => ({
          value: c.latest?.median ?? null,
          itemStyle: { color: contentPalette[i] },
        })),
        label: {
          show: true,
          position: "right",
          fontSize: 10,
          formatter: (p) => (p.value == null ? "" : short(+p.value.toFixed(1))),
        },
      },
    ],
    (params) => {
      const c = categories[params[0]?.dataIndex];
      return c
        ? `${escape(c.name)}<br>Median ${escape(name)}: <b>${contentValue(c.latest?.median ?? null)}</b><br>${c.latest?.available ?? 0}/${c.count} posts with available counters`
        : "";
    },
  );
  categoryLines("category-growth", ctx.dates, categories, "mean");
  categoryLines("category-change", ctx.dates, categories, "change");
  renderCategoryDiffusion(ctx, field);

  const crisisGroups = contentGroups(items, "crisisRelevance");
  chart(
    "crisis-growth",
    base(ctx.dates, {
      color: contentPalette,
      series: crisisGroups.names.map((name) => ({
        name,
        type: "line",
        stack: "posts",
        step: "end",
        symbol: "none",
        areaStyle: { opacity: 0.12 },
        data: ctx.dates.map(
          (date) =>
            items.filter(
              (item) =>
                item.firstSeen <= date && crisisGroups.group(item) === name,
            ).length,
        ),
      })),
      graphic: items.length
        ? []
        : [
            {
              type: "text",
              left: "center",
              top: "middle",
              style: { text: "No posts match these filters", fill: "#68747c" },
            },
          ],
    }),
  );
  const phases = contentGroups(ctx.roots, "crisisPhase");
  categoryBars(
    "crisis-phase",
    phases.names,
    [
      {
        data: phases.names.map((name, i) => ({
          value: ctx.roots.filter((r) => phases.group(r) === name).length,
          itemStyle: { color: contentPalette[i] },
        })),
        label: { show: true, position: "right" },
      },
    ],
    (params) => {
      const p = params[0];
      return p ? `${escape(p.name)}<br>${fmt(p.value)} originals` : "";
    },
  );
  $("crisis-phase-note").textContent =
    `${ctx.roots.length && new Set(ctx.roots.map((r) => r.crisisPhase)).size === 1 ? "Only one recorded phase is present; a between-phase comparison is unavailable. " : ""}Stable is the collector's default when no external crisis window matches (including absent context data), not independent evidence of a crisis-free period. Quote posts do not receive an inferred phase.`;
}
