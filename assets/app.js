"use strict";
const $ = (id) => document.getElementById(id);
const fmt = (n) =>
  n == null ? "Unavailable" : new Intl.NumberFormat("en-US").format(n);
const short = (n) =>
  Math.abs(n) >= 1e6
    ? `${+(n / 1e6).toFixed(1)}m`
    : Math.abs(n) >= 1e3
      ? `${+(n / 1e3).toFixed(1)}k`
      : n;
const escape = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const labelDate = (d) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const dayGap = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const labels = ["Views", "Likes", "Reposts", "Replies", "Quotes", "Bookmarks"];
const colors = [
  "#147d65",
  "#1684a8",
  "#c44e87",
  "#91662d",
  "#6a60b7",
  "#536d7d",
];
const mechanisms = [
  "level_1_repost",
  "repost_descendant",
  "quote_post",
  "quote_repost",
];
const mechanismLabel = {
  original_post: "Original post",
  level_1_repost: "Direct repost",
  repost_descendant: "Deeper repost",
  quote_post: "Quote post",
  quote_repost: "Repost of quote",
  primary_post: "Original post",
  continuous_quote: "Quote post",
};
const mechanismColor = {
  original_post: "#252e35",
  level_1_repost: "#1684a8",
  repost_descendant: "#6a60b7",
  quote_post: "#c44e87",
  quote_repost: "#d69c38",
};
const charts = new Map();
let data,
  view = "overview",
  basis = "firstSeen",
  xaxis = "date",
  timer;
const state = {
  account: "all",
  theme: "all",
  date: "",
  metric: 0,
  scope: "original_post",
  root: "",
  treeDate: "",
};
const icons = () => window.lucide?.createIcons();

function selectedRoots() {
  return data.roots.filter(
    (r) =>
      r.firstSeen <= state.date &&
      (state.account === "all" || r.account === state.account) &&
      (state.theme === "all" || r.theme === state.theme),
  );
}
function context() {
  const roots = selectedRoots(),
    ids = new Set(roots.map((r) => r.id));
  return {
    roots,
    ids,
    dates: data.dates.filter((d) => d <= state.date),
    nodes: data.nodes.filter(
      (n) => ids.has(n.root) && n.firstSeen <= state.date,
    ),
    obs: data.observations.filter(
      (o) => ids.has(o.root) && o.date <= state.date,
    ),
  };
}
function chart(id, option) {
  const element = $(id);
  if (!element || element.closest("[hidden]")) return;
  let instance = charts.get(id);
  if (!instance) {
    instance = echarts.init(element, null, { renderer: "canvas" });
    charts.set(id, instance);
  }
  instance.setOption(
    {
      animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      animationDuration: 350,
      textStyle: {
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      },
      ...option,
    },
    true,
  );
  instance.resize();
  return instance;
}
function base(dates, options = {}) {
  return {
    color: colors,
    grid: { left: 45, right: 15, top: 45, bottom: 38, containLabel: false },
    tooltip: {
      trigger: "axis",
      confine: true,
      textStyle: { fontSize: 12 },
      extraCssText: "max-width:320px;white-space:normal",
    },
    legend: {
      type: "scroll",
      top: 4,
      left: 0,
      right: 0,
      textStyle: { fontSize: 10, color: "#68747c" },
      itemWidth: 12,
      itemHeight: 7,
    },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: {
        fontSize: 10,
        color: "#68747c",
        formatter: labelDate,
        hideOverlap: true,
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#d7e0e5" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 10, color: "#68747c", formatter: short },
      splitLine: { lineStyle: { color: "#eef1f3" } },
      minInterval: 1,
    },
    ...options,
  };
}
function countSeries(nodes, dates, cumulative = false, timeKey = "firstSeen") {
  return mechanisms.map((key) => ({
    name: mechanismLabel[key],
    type: cumulative ? "line" : "bar",
    stack: "events",
    itemStyle: { color: mechanismColor[key] },
    lineStyle: { width: 2 },
    symbol: "none",
    areaStyle: cumulative ? { opacity: 0.14 } : undefined,
    data: dates.map(
      (d) =>
        nodes.filter(
          (n) =>
            n.mechanism === key &&
            (cumulative ? n[timeKey] <= d : n[timeKey] === d),
        ).length,
    ),
  }));
}
function plotAccountMetric(ctx, metric, scope) {
  const rootMap = new Map(ctx.roots.map((r) => [r.id, r]));
  const rows = ctx.obs.filter(
    (o) => o.mechanism === scope && o.status === "returned",
  );
  const accounts = data.accounts.filter((a) =>
    ctx.roots.some((r) => r.account === a),
  );
  const indexed = new Map(rows.map((o) => [`${o.node}|${o.date}`, o]));
  const series = accounts.map((a) => ({
    name: a,
    type: "line",
    symbol: "circle",
    symbolSize: 5,
    connectNulls: false,
    itemStyle: { color: colors[data.accounts.indexOf(a)] },
    lineStyle: { width: 2 },
    data: ctx.dates.map((d) => {
      const values = rows
        .filter((o) => o.date === d && rootMap.get(o.root).account === a)
        .map((o) => o.metrics[metric])
        .filter((v) => v != null);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    }),
  }));
  chart("growth", base(ctx.dates, { series }));
  const stats = ctx.dates.map((d) => {
    let matched = 0,
      change = 0,
      first = 0;
    const previous = new Date(Date.parse(d) - 86400000)
      .toISOString()
      .slice(0, 10);
    rows
      .filter((o) => o.date === d)
      .forEach((o) => {
        const p = indexed.get(`${o.node}|${previous}`);
        if (p && p.metrics[metric] != null && o.metrics[metric] != null) {
          matched++;
          change += o.metrics[metric] - p.metrics[metric];
        } else first++;
      });
    return {
      date: d,
      matched,
      change: matched ? change : null,
      unmatched: first,
    };
  });
  chart(
    "changes",
    base(ctx.dates, {
      legend: { show: false },
      tooltip: {
        trigger: "axis",
        confine: true,
        formatter: (params) => {
          const s = stats[params[0].dataIndex];
          return `${escape(labelDate(s.date))}<br><b>${s.change == null ? "No comparable pair" : (s.change > 0 ? "+" : "") + fmt(s.change)}</b> ${labels[metric].toLowerCase()}<br>${s.matched} matched posts; ${s.unmatched} without a comparable prior day`;
        },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 40,
          data: stats.map((s) => ({
            value: s.change,
            itemStyle: {
              color: s.change < 0 ? "#c44e87" : "#147d65",
              borderRadius: [2, 2, 0, 0],
            },
          })),
        },
      ],
    }),
  );
  const latest = stats.at(-1);
  $("growth-note").textContent =
    "Sum of available cumulative counters for the selected posts, as observed each day. Admissions and unavailable metrics affect totals.";
  $("changes-note").textContent =
    `Latest interval: ${latest?.matched ?? 0} matched posts; ${latest?.unmatched ?? 0} without a comparable prior day. Negative changes are retained.`;
}
function renderOverview(ctx) {
  const latest = ctx.obs.filter(
    (o) =>
      o.date === state.date &&
      o.mechanism === "original_post" &&
      o.status === "returned",
  );
  const views = latest.map((o) => o.metrics[0]).filter((v) => v != null);
  const newNodes = ctx.nodes.filter((n) => n.firstSeen === state.date);
  const uniqueViews = views.length ? views.reduce((a, b) => a + b, 0) : null;
  const stats = [
    [
      "Original posts",
      ctx.roots.length,
      `${new Set(ctx.roots.map((r) => r.account)).size} FDA accounts represented`,
      "file-text",
    ],
    [
      "Observed diffusion events",
      ctx.nodes.length,
      `${newNodes.length} first observed on ${labelDate(state.date)}`,
      "git-fork",
    ],
    [
      "Original-post views",
      uniqueViews,
      `${views.length} posts with returned view counts`,
      "eye",
    ],
    [
      "Observation days",
      ctx.dates.length,
      `${labelDate(ctx.dates[0])} through ${labelDate(state.date)}`,
      "calendar-days",
    ],
  ];
  $("stats").innerHTML = stats
    .map(
      ([name, value, note, icon]) =>
        `<div class="stat"><div class="stat-label"><i data-lucide="${icon}"></i>${name}</div><div class="stat-value">${fmt(value)}</div><p class="stat-detail">${escape(note)}</p></div>`,
    )
    .join("");
  plotAccountMetric(ctx, state.metric, state.scope);
  const eventDates =
    basis === "created"
      ? [...new Set([...ctx.dates, ...ctx.nodes.map((n) => n.created)])]
          .filter((d) => d <= state.date)
          .sort()
      : ctx.dates;
  chart(
    "new-events",
    base(eventDates, {
      series: countSeries(ctx.nodes, eventDates, false, basis),
    }),
  );
  $("new-events").previousElementSibling.querySelector("h3").textContent =
    basis === "created"
      ? "Diffusion events by creation date"
      : "Newly observed diffusion events";
  $("events-note").textContent =
    basis === "created"
      ? "API event creation dates in Chicago time. Only events known by the selected observation cutoff are included."
      : "First discovery date in Chicago time. These events may have been created earlier; repeated retrieval is excluded.";
  chart(
    "network-growth",
    base(ctx.dates, { series: countSeries(ctx.nodes, ctx.dates, true) }),
  );
  const themes = [...new Set(ctx.roots.map((r) => r.theme))]
    .map((t) => ({
      name: t,
      value: ctx.roots.filter((r) => r.theme === t).length,
    }))
    .sort((a, b) => a.value - b.value);
  chart("themes", {
    grid: { left: 200, right: 35, top: 20, bottom: 25 },
    tooltip: { trigger: "axis", confine: true },
    xAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { fontSize: 10, color: "#68747c" },
      splitLine: { lineStyle: { color: "#eef1f3" } },
    },
    yAxis: {
      type: "category",
      data: themes.map((t) => t.name),
      axisLabel: {
        width: 185,
        overflow: "truncate",
        fontSize: 10,
        color: "#53636c",
      },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 20,
        data: themes.map((t, i) => ({
          value: t.value,
          itemStyle: { color: colors[i % colors.length] },
        })),
        label: { show: true, position: "right", fontSize: 11 },
      },
    ],
  });
  chart(
    "cohort",
    base(ctx.dates, {
      series: data.accounts
        .filter((a) => ctx.roots.some((r) => r.account === a))
        .map((a) => ({
          name: a,
          type: "bar",
          stack: "accounts",
          itemStyle: { color: colors[data.accounts.indexOf(a)] },
          data: ctx.dates.map(
            (d) =>
              ctx.obs.filter(
                (o) =>
                  o.date === d &&
                  o.mechanism === "original_post" &&
                  ctx.roots.find((r) => r.id === o.root)?.account === a,
              ).length,
          ),
        })),
    }),
  );
}
function rootOptions(ctx) {
  const order = [...ctx.roots].sort(
    (a, b) =>
      ctx.nodes.filter((n) => n.root === b.id).length -
      ctx.nodes.filter((n) => n.root === a.id).length,
  );
  if (!order.some((r) => r.id === state.root)) state.root = order[0]?.id || "";
  const html = order
    .map(
      (r) => `<option value="${r.id}">${escape(r.account)} / ${r.id}</option>`,
    )
    .join("");
  for (const id of ["tree-root", "post-root"]) {
    $(id).innerHTML = html;
    $(id).value = state.root;
  }
}
function rootContext(root, nodes) {
  if (!root) return "No original posts match these filters.";
  return `<strong>${escape(root.summary)}</strong><div class="post-meta"><a href="https://x.com/${encodeURIComponent(root.account)}/status/${root.id}" target="_blank" rel="noopener">@${escape(root.account)} / ${root.id} ↗</a><span>Created ${labelDate(root.created)}</span><span>First collected ${labelDate(root.firstSeen)}</span><span>${nodes.length} observed edges</span><span>${escape(root.theme)}</span></div>`;
}
function renderTree(ctx) {
  const root = ctx.roots.find((r) => r.id === state.root);
  const rootNodes = ctx.nodes.filter((n) => n.root === state.root);
  $("tree-summary").innerHTML = rootContext(root, rootNodes);
  if (!state.treeDate || state.treeDate > state.date)
    state.treeDate = state.date;
  $("tree-day").max = ctx.dates.length - 1;
  $("tree-day").value = Math.max(0, ctx.dates.indexOf(state.treeDate));
  $("tree-date").textContent = labelDate(state.treeDate);
  const nodes = rootNodes.filter((n) => n.firstSeen <= state.treeDate);
  const labelsById = new Map(
    rootNodes.map((n, i) => [
      n.id,
      `${n.mechanism === "quote_post" ? "Quote" : "Repost"} ${i + 1}`,
    ]),
  );
  const children = new Map();
  nodes.forEach((n) => {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n);
  });
  const treeNode = (n, path = new Set()) => {
    if (path.has(n.id)) return null;
    const next = new Set([...path, n.id]);
    const kids = children.get(n.id) || [];
    const repostLeaves = kids.filter(
      (k) => k.mechanism !== "quote_post" && !children.has(k.id),
    );
    const other = kids.filter((k) => !repostLeaves.includes(k));
    const branches = other.map((k) => treeNode(k, next)).filter(Boolean);
    for (const mechanism of mechanisms) {
      const group = repostLeaves.filter((k) => k.mechanism === mechanism);
      if (group.length)
        branches.push({
          name: `${fmt(group.length)} ${mechanismLabel[mechanism].toLowerCase()}${group.length === 1 ? "" : "s"}`,
          groupCount: group.length,
          mechanism,
          collapsed: true,
          itemStyle: { color: mechanismColor[mechanism] },
          symbolSize: 14,
          children: group.map((k) => ({
            name: labelsById.get(k.id),
            id: k.id,
            info: k,
            symbolSize: 5,
            label: { show: false },
            itemStyle: { color: mechanismColor[mechanism] },
          })),
        });
    }
    const isRoot = n.id === state.root;
    return {
      name: isRoot ? `@${root.account}` : labelsById.get(n.id),
      id: n.id,
      info: n,
      children: branches,
      symbolSize: isRoot ? 18 : 11,
      itemStyle: { color: mechanismColor[n.mechanism] },
      collapsed: false,
      label: {
        ...(isRoot ? { position: "top", align: "center" } : {}),
        fontSize: 10,
        color: "#3f515d",
        backgroundColor: "#ffffffdc",
        padding: 3,
      },
    };
  };
  const ready = root && root.firstSeen <= state.treeDate;
  const tree = ready
    ? treeNode({
        id: root.id,
        mechanism: "original_post",
        level: 0,
        created: root.created,
        firstSeen: root.firstSeen,
      })
    : null;
  const c = chart("tree", {
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (p) =>
        p.data.groupCount
          ? `${p.data.groupCount} observed ${escape(mechanismLabel[p.data.mechanism].toLowerCase())} events`
          : `${escape(p.name)}<br>${escape(mechanismLabel[p.data.info?.mechanism] || "")}<br>Created ${escape(p.data.info?.created)}<br>First observed ${escape(p.data.info?.firstSeen)}`,
    },
    series: tree
      ? [
          {
            type: "tree",
            data: [tree],
            top: 35,
            left: 70,
            bottom: 35,
            right: 150,
            orient: "LR",
            roam: true,
            expandAndCollapse: true,
            initialTreeDepth: 2,
            edgeShape: "polyline",
            edgeForkPosition: "45%",
            lineStyle: { color: "#b7c7ce", width: 1.1 },
            label: { position: "left", align: "right" },
            leaves: { label: { position: "right", align: "left" } },
            emphasis: { focus: "descendant" },
            animationDurationUpdate: 350,
          },
        ]
      : [],
    graphic: tree
      ? []
      : [
          {
            type: "text",
            left: "center",
            top: "middle",
            style: {
              text: root
                ? "This root had not been observed on this date."
                : "No roots match these filters.",
              fill: "#68747c",
              fontSize: 13,
            },
          },
        ],
  });
  c?.off("click");
  c?.on("click", (p) => {
    const n = p.data.info;
    if (!n) {
      $("node-detail").textContent =
        `${p.data.groupCount} individually observed ${mechanismLabel[p.data.mechanism].toLowerCase()} events from this parent.`;
      return;
    }
    const obs = ctx.obs
      .filter((o) => o.node === n.id && o.date <= state.treeDate)
      .at(-1);
    $("node-detail").innerHTML =
      `<strong>${escape(p.name)} · ${escape(mechanismLabel[n.mechanism])}</strong> · Observed level ${n.level}<br>Created ${escape(n.created)} · First observed ${escape(n.firstSeen)}${obs ? `<br>${escape(obs.date)} counters: ${labels.map((l, i) => `${l} ${fmt(obs.metrics[i])}`).join(" · ")}${obs.status !== "returned" ? " · Lookup missing" : ""}` : "<br>No daily metric observation by this date."}`;
  });
  $("roots-table").innerHTML = ctx.roots
    .map((r) => {
      const ns = ctx.nodes.filter((n) => n.root === r.id);
      return `<tr><td class="root-name">${escape(r.summary)}<div class="root-id">${r.id}</div></td><td>${escape(r.account)}</td><td>${fmt(ns.filter((n) => ["level_1_repost", "repost_descendant"].includes(n.mechanism)).length)}</td><td>${fmt(ns.filter((n) => n.mechanism === "quote_post").length)}</td><td>${fmt(ns.filter((n) => n.mechanism === "quote_repost").length)}</td><td>${Math.max(0, ...ns.map((n) => n.level))}</td><td><button class="icon-button" data-root="${r.id}" title="Open diffusion tree" aria-label="Open tree for ${r.id}"><i data-lucide="arrow-up-right"></i></button></td></tr>`;
    })
    .join("");
  $("roots-table")
    .querySelectorAll("[data-root]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          state.root = b.dataset.root;
          state.treeDate = state.date;
          rootOptions(ctx);
          renderTree(ctx);
          $("tree-root").scrollIntoView({ behavior: "smooth", block: "start" });
          icons();
        }),
    );
}
function renderTrajectories(ctx) {
  const root = ctx.roots.find((r) => r.id === state.root);
  $("post-summary").innerHTML = rootContext(
    root,
    ctx.nodes.filter((n) => n.root === state.root),
  );
  const rows = ctx.obs.filter(
    (o) => o.root === state.root && o.mechanism === "original_post",
  );
  const dates = ctx.dates.filter((d) => !root || d >= root.firstSeen);
  const obs = new Map(rows.map((o) => [o.date, o]));
  labels.forEach((label, i) =>
    chart(
      `metric-${i}`,
      base(dates, {
        legend: { show: false },
        grid: { left: 44, right: 15, top: 20, bottom: 35 },
        xAxis: {
          ...base(dates).xAxis,
          axisLabel: {
            ...base(dates).xAxis.axisLabel,
            formatter: (d) =>
              xaxis === "age" ? `Day ${dayGap(d, root.created)}` : labelDate(d),
          },
        },
        series: [
          {
            type: "line",
            name: label,
            data: dates.map((d) =>
              obs.get(d)?.status === "returned" ? obs.get(d).metrics[i] : null,
            ),
            connectNulls: false,
            symbolSize: 6,
            itemStyle: { color: colors[i] },
            lineStyle: { width: 2 },
            areaStyle: { opacity: 0.05 },
          },
        ],
      }),
    ),
  );
  const metric = Number($("heat-metric").value);
  const points = [];
  const indexed = new Map(
    ctx.obs
      .filter((o) => o.mechanism === "original_post" && o.status === "returned")
      .map((o) => [`${o.root}|${o.date}`, o]),
  );
  ctx.roots.forEach((r, y) =>
    ctx.dates.forEach((d, x) => {
      const previous = new Date(Date.parse(d) - 86400000)
        .toISOString()
        .slice(0, 10);
      const a = indexed.get(`${r.id}|${previous}`),
        b = indexed.get(`${r.id}|${d}`);
      if (a?.metrics[metric] != null && b?.metrics[metric] != null)
        points.push([x, y, b.metrics[metric] - a.metrics[metric]]);
    }),
  );
  const positive = Math.max(1, ...points.map((p) => p[2]));
  chart("heatmap", {
    grid: { left: 135, right: 15, top: 20, bottom: 80 },
    tooltip: {
      position: "top",
      confine: true,
      formatter: (p) =>
        `${escape(ctx.roots[p.value[1]].account)} / ...${ctx.roots[p.value[1]].id.slice(-6)}<br>${labelDate(ctx.dates[p.value[0]])}<br>${fmt(p.value[2])} net ${labels[metric].toLowerCase()}`,
    },
    xAxis: {
      type: "category",
      data: ctx.dates,
      axisLabel: { fontSize: 10, formatter: labelDate },
      splitArea: { show: true },
    },
    yAxis: {
      type: "category",
      data: ctx.roots.map((r) => `${r.account} · ${r.id.slice(-5)}`),
      axisLabel: { fontSize: 10 },
      splitArea: { show: true },
    },
    visualMap: {
      min: 0,
      max: positive,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      calculable: true,
      text: ["Larger increase", "No change"],
      inRange: { color: ["#edf2f0", "#a1cdbc", "#147d65"] },
    },
    series: [
      {
        type: "heatmap",
        data: points.map((p) => ({
          value: p,
          itemStyle:
            p[2] < 0
              ? { color: "#c44e87", borderColor: "#fff", borderWidth: 2 }
              : { borderColor: "#fff", borderWidth: 2 },
        })),
        label: {
          show: ctx.roots.length <= 18,
          fontSize: 9,
          formatter: (p) => short(p.value[2]),
        },
        emphasis: { itemStyle: { borderWidth: 2, borderColor: "#252e35" } },
      },
    ],
  });
}
function renderMethods(ctx) {
  const integrity = data.integrity.filter((i) => i.date <= state.date);
  const kinds = [...new Set(integrity.map((i) => i.mechanism))];
  chart(
    "coverage",
    base(ctx.dates, {
      yAxis: {
        ...base(ctx.dates).yAxis,
        min: 0,
        max: 100,
        axisLabel: { fontSize: 10, formatter: "{value}%" },
      },
      series: kinds.map((key, i) => ({
        name: mechanismLabel[key] || key,
        type: "line",
        symbolSize: 6,
        itemStyle: { color: colors[i] },
        data: ctx.dates.map((d) => {
          const r = integrity.find((x) => x.date === d && x.mechanism === key);
          return r?.expected
            ? +((100 * r.returned) / r.expected).toFixed(2)
            : null;
        }),
      })),
    }),
  );
  $("coverage-table").innerHTML = [...integrity]
    .reverse()
    .map(
      (r) =>
        `<tr><td>${r.date}</td><td>${escape(mechanismLabel[r.mechanism] || r.mechanism)}</td><td>${fmt(r.expected)}</td><td>${fmt(r.attempted)}</td><td>${fmt(r.returned)}</td><td>${fmt(r.missing)}</td><td>${r.expected ? ((100 * r.attempted) / r.expected).toFixed(1) + "%" : "N/A"}</td></tr>`,
    )
    .join("");
  $("provenance").textContent =
    `Source snapshot: ${data.sourceSnapshot}. Collection completed ${new Date(data.collectionCompletedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} America/Chicago. ${fmt(data.observations.length)} canonical entity-day observations.`;
}
function render() {
  const ctx = context();
  $("filter-result").textContent =
    `${ctx.roots.length} originals · ${fmt(ctx.nodes.length)} edges`;
  rootOptions(ctx);
  if (view === "overview") renderOverview(ctx);
  if (view === "diffusion") renderTree(ctx);
  if (view === "trajectories") renderTrajectories(ctx);
  if (view === "methods") renderMethods(ctx);
  icons();
}
function navigate(next) {
  view = ["overview", "diffusion", "trajectories", "methods"].includes(next)
    ? next
    : "overview";
  if (timer) stopPlay();
  document
    .querySelectorAll(".view")
    .forEach((el) => (el.hidden = el.id !== view));
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false");
  });
  render();
}
function stopPlay() {
  clearInterval(timer);
  timer = null;
  $("play").innerHTML = '<i data-lucide="play"></i>';
  $("play").setAttribute("aria-label", "Play daily diffusion");
  icons();
}
function exportCSV() {
  const ctx = context();
  const values = [
    [
      "observation_date_chicago",
      "account",
      "root_post_id",
      "anonymous_node_id",
      "mechanism",
      "lookup_status",
      ...data.metrics,
    ],
    ...ctx.obs.map((o) => [
      o.date,
      ctx.roots.find((r) => r.id === o.root).account,
      o.root,
      o.node,
      o.mechanism,
      o.status,
      ...o.metrics,
    ]),
  ];
  const csv = values
    .map((r) =>
      r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `fda-x-daily-${state.date}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function init() {
  icons();
  try {
    const response = await fetch("data/dashboard.json");
    if (!response.ok)
      throw new Error(`Data request failed (${response.status})`);
    data = await response.json();
    state.date = data.asOf;
    state.treeDate = data.asOf;
    $("latest-date").textContent = new Date(
      `${data.asOf}T12:00:00Z`,
    ).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    $("footer-range").textContent =
      `${labelDate(data.dates[0])} – ${labelDate(data.asOf)}, ${data.asOf.slice(0, 4)} · America/Chicago`;
    $("account").innerHTML += [...data.accounts]
      .map((a) => `<option value="${a}">${a}</option>`)
      .join("");
    $("theme").innerHTML += [...new Set(data.roots.map((r) => r.theme))]
      .sort()
      .map((t) => `<option value="${escape(t)}">${escape(t)}</option>`)
      .join("");
    $("asof").innerHTML = data.dates
      .map(
        (d) =>
          `<option value="${d}">${labelDate(d)}, ${d.slice(0, 4)}</option>`,
      )
      .join("");
    $("asof").value = state.date;
    const metricOptions = labels
      .map((l, i) => `<option value="${i}">${l}</option>`)
      .join("");
    $("metric").innerHTML = metricOptions;
    $("heat-metric").innerHTML = metricOptions;
    $("metric-plots").innerHTML = labels
      .map(
        (l, i) =>
          `<article class="mini-plot"><div class="chart-heading"><h3>${l}</h3><button class="icon-button" data-save="metric-${i}" title="Download chart" aria-label="Download ${l.toLowerCase()} chart"><i data-lucide="image-down"></i></button></div><div id="metric-${i}" class="mini-chart" role="img" aria-label="${l} trajectory"></div></article>`,
      )
      .join("");
    $("tree-legend").innerHTML = ["original_post", ...mechanisms]
      .map(
        (k) =>
          `<span><i class="swatch" style="background:${mechanismColor[k]}"></i>${mechanismLabel[k]}</span>`,
      )
      .join("");
    $("account").onchange = (e) => {
      state.account = e.target.value;
      render();
    };
    $("theme").onchange = (e) => {
      state.theme = e.target.value;
      render();
    };
    $("asof").onchange = (e) => {
      stopPlay();
      state.date = e.target.value;
      state.treeDate = state.date;
      render();
    };
    $("metric").onchange = (e) => {
      state.metric = Number(e.target.value);
      render();
    };
    $("engagement-scope").onchange = (e) => {
      state.scope = e.target.value;
      render();
    };
    $("reset").onclick = () => {
      stopPlay();
      state.account = "all";
      state.theme = "all";
      state.date = data.asOf;
      state.treeDate = state.date;
      $("account").value = "all";
      $("theme").value = "all";
      $("asof").value = state.date;
      render();
    };
    document.querySelectorAll("[data-view]").forEach(
      (b) =>
        (b.onclick = () => {
          location.hash = b.dataset.view;
        }),
    );
    document.querySelectorAll("[data-basis]").forEach(
      (b) =>
        (b.onclick = () => {
          basis = b.dataset.basis;
          document
            .querySelectorAll("[data-basis]")
            .forEach((x) => x.classList.toggle("active", x === b));
          render();
        }),
    );
    document.querySelectorAll("[data-xaxis]").forEach(
      (b) =>
        (b.onclick = () => {
          xaxis = b.dataset.xaxis;
          document
            .querySelectorAll("[data-xaxis]")
            .forEach((x) => x.classList.toggle("active", x === b));
          render();
        }),
    );
    for (const id of ["tree-root", "post-root"])
      $(id).onchange = (e) => {
        state.root = e.target.value;
        state.treeDate = state.date;
        render();
      };
    $("heat-metric").onchange = render;
    $("tree-day").oninput = (e) => {
      state.treeDate = context().dates[Number(e.target.value)];
      renderTree(context());
    };
    $("tree-reset").onclick = () => {
      state.treeDate = state.date;
      renderTree(context());
    };
    $("play").onclick = () => {
      if (timer) {
        stopPlay();
        return;
      }
      const ctx = context();
      let i = 0;
      state.treeDate = ctx.dates[0];
      renderTree(ctx);
      $("play").innerHTML = '<i data-lucide="pause"></i>';
      $("play").setAttribute("aria-label", "Pause daily diffusion");
      icons();
      timer = setInterval(() => {
        i++;
        if (i >= ctx.dates.length) {
          stopPlay();
          return;
        }
        state.treeDate = ctx.dates[i];
        renderTree(ctx);
      }, 1000);
    };
    $("download").onclick = exportCSV;
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-save]");
      if (!b) return;
      const c = charts.get(b.dataset.save);
      if (!c) return;
      const a = document.createElement("a");
      a.href = c.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: "#fff",
      });
      a.download = `fda-x-${b.dataset.save}-${state.date}.png`;
      a.click();
    });
    window.addEventListener("hashchange", () =>
      navigate(location.hash.slice(1)),
    );
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(
        () =>
          charts.forEach((c, id) => {
            if (!$(id).closest("[hidden]")) c.resize();
          }),
        100,
      );
    });
    $("loading").hidden = true;
    $("dashboard").hidden = false;
    navigate(location.hash.slice(1) || "overview");
  } catch (error) {
    $("loading").hidden = true;
    $("error").hidden = false;
    $("error").textContent =
      `The public dataset could not be loaded. ${error.message}. Please reload or view the repository.`;
    console.error(error);
  }
}
init();
