// -----------------------------------------------------
// 0. SUPABASE REALTIME CONFIG (OPTION B1 - Realtime)
// -----------------------------------------------------
const SUPABASE_URL = "https://uyunyqwqbvrjipblitcv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5dW55cXdxYnZyamlwYmxpdGN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MjA2MTYsImV4cCI6MjA3OTE5NjYxNn0.abGBR8EF3Ak5p4Lnb5BZYUkmodQ4kjQDFUyX2s-nSyg";

// Supabase client (from UMD script in index.html)
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Global dashboard state (no polling, only realtime)
let lastState = {
  nodes: {},   // key: "zone/node" → { latest: {...} }
  alerts: [],  // array of alert objects
  logs: []     // array of { ts, msg }
};
let selectedFilter = "all";


// -----------------------------------------------------
// 1. GAUGE HELPERS (same look as before)
// -----------------------------------------------------
function createRingSVG(containerId, size = 170, stroke = 14) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

  const center = size / 2;
  const radius = (size - stroke) / 2;

  // background
  const bg = document.createElementNS(NS, "circle");
  bg.setAttribute("cx", center);
  bg.setAttribute("cy", center);
  bg.setAttribute("r", radius);
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "rgba(255,255,255,0.06)");
  bg.setAttribute("stroke-width", stroke);
  svg.appendChild(bg);

  // foreground
  const fg = document.createElementNS(NS, "circle");
  fg.setAttribute("cx", center);
  fg.setAttribute("cy", center);
  fg.setAttribute("r", radius);
  fg.setAttribute("fill", "none");
  fg.setAttribute("stroke-linecap", "round");
  fg.setAttribute("stroke-width", stroke);
  fg.setAttribute("transform", `rotate(-90 ${center} ${center})`);
  const circ = 2 * Math.PI * radius;
  fg.style.strokeDasharray = `${circ} ${circ}`;
  fg.style.strokeDashoffset = `${circ}`;
  fg.dataset.circ = String(circ);
  svg.appendChild(fg);

  // text
  const text = document.createElementNS(NS, "text");
  text.setAttribute("x", center);
  text.setAttribute("y", center + 6);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "18");
  text.setAttribute("fill", "#073012");
  text.textContent = "--";
  svg.appendChild(text);

  const container = document.getElementById(containerId);
  if (!container) return null;
  container.innerHTML = "";
  container.appendChild(svg);

  return {
    svg,
    fg,
    text,
    setValue(percent, color) {
      const clamped = typeof percent === "number"
        ? Math.max(0, Math.min(100, percent))
        : percent;
      const offset = typeof clamped === "number"
        ? Number(fg.dataset.circ) * (1 - clamped / 100)
        : Number(fg.dataset.circ);

      fg.style.transition = "stroke-dashoffset 700ms ease, stroke 500ms ease";
      fg.style.strokeDashoffset = offset;
      fg.style.stroke = color;
      text.textContent =
        typeof clamped === "number" ? `${Math.round(clamped)}%` : clamped;
    }
  };
}

// color mapping: green → yellow → orange → red
function colorForValue(percent, reverse = false) {
  if (reverse) {
    // For battery: low = red, high = green
    if (percent <= 20) return "#e74c3c";
    if (percent <= 50) return "#ff9f43";
    return "#2f9e44";
  } else {
    if (percent >= 85) return "#e74c3c";
    if (percent >= 70) return "#ff9f43";
    if (percent >= 40) return "#f1c40f";
    return "#2f9e44";
  }
}

const gaugeIds = [
  "gauge-pffi", "gauge-temp", "gauge-hum", "gauge-dB", "gauge-aqi", "gauge-vpd",
  "g-heat", "g-dew", "g-fmi",
  "g-mq2", "g-mq135", "g-aqi2",
  "g-noise-env", "g-wildlife", "g-threat"
];

const gauges = {};

function initGauges() {
  gaugeIds.forEach((id) => {
    if (document.getElementById(id)) {
      gauges[id] = createRingSVG(id, 170, 14);
    }
  });
}


// -----------------------------------------------------
// 2. UI HELPERS (header, table, alerts, logs)
// -----------------------------------------------------
function setHeaderCounts(nodes, alerts) {
  document.getElementById("node-count").textContent =
    `Nodes: ${Object.keys(nodes || {}).length}`;
  document.getElementById("alerts-count").textContent =
    `Alerts: ${(alerts && alerts.length) || 0}`;
}

function formatTS(ts) {
  if (!ts) return "-";
  const t = ts > 1e12 ? ts : ts * 1000;
  const d = new Date(Number(t));
  return d.toLocaleString();
}

// Nodes table with filters
function renderNodesTable(nodesObj) {
  const tbody = document.querySelector("#nodes-table tbody");
  tbody.innerHTML = "";

  const now = Date.now();
  const nodes = Object.values(nodesObj || {}).map((n) => n.latest || n);

  const filtered = nodes.filter((node) => {
    if (selectedFilter === "online") {
      return now - node.timestamp * 1000 < 30000;
    }
    if (selectedFilter === "offline") {
      return now - node.timestamp * 1000 >= 30000;
    }
    if (selectedFilter === "lowbattery") {
      return (node.battery_pct || 0) < 25;
    }
    if (selectedFilter === "firerisk") {
      return (node.computed?.pffi || 0) >= 70;
    }
    return true;
  });

  if (!filtered.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="9" style="text-align:center;color:#6b6b6b;padding:18px">
        No nodes match this filter
      </td>`;
    tbody.appendChild(tr);
    return;
  }

  filtered.forEach((node) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${node.zoneId}/${node.nodeId}</td>
      <td>${node.temp_c ?? "-"}</td>
      <td>${node.hum_pct ?? "-"}</td>
      <td>${node.mq2 ?? "-"}</td>
      <td>${node.mq135 ?? "-"}</td>
      <td>${node.dB ?? "-"}</td>
      <td>${node.battery_pct ?? "-"}</td>
      <td>${node.rssi ?? "-"}</td>
      <td>${formatTS(node.timestamp)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function handleFlameTrigger(nodeKey) {
    // Highlight the node row in red
    const rows = document.querySelectorAll("#nodes-table tbody tr");
    rows.forEach(row => {
        if (row.innerHTML.includes(nodeKey)) {
            row.style.background = "rgba(255, 0, 0, 0.25)";
            row.style.transition = "background 0.6s ease";
        }
    });

    // Auto-switch to Alerts page
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
    document.querySelector('[data-page="alerts"]').classList.add("active");

    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.getElementById("page-alerts").classList.add("active");

    // Scroll Alerts to top
    window.scrollTo({ top: 0, behavior: "smooth" });
}


// -------- Alerts categorization ----------
function categorizeAlerts(alerts) {
  const categories = { fire: [], gas: [], acoustic: [] };

  alerts.forEach((a) => {
    if ((a.pffi && a.pffi >= 60) || (a.mq2 && a.mq2 >= 300)) {
      categories.fire.push(a);
    }
    if ((a.mq135 && a.mq135 >= 350) || (a.mq2 && a.mq2 >= 200)) {
      categories.gas.push(a);
    }
    if ((a.dB && a.dB >= 85) || (a.sound_confidence && a.sound_confidence >= 50)) {
      categories.acoustic.push(a);
    }
  });

  return categories;
}

function renderAlerts(alerts) {
  const container = document.getElementById("alerts-list");
  const groups = categorizeAlerts(alerts || []);
  container.innerHTML = "";

  function block(title, arr, color) {
    const box = document.createElement("div");
    box.style.marginBottom = "18px";

    const h = document.createElement("h4");
    h.textContent = title;
    h.style.color = color;
    h.style.marginBottom = "8px";
    box.appendChild(h);

    if (!arr.length) {
      const none = document.createElement("div");
      none.textContent = "None";
      none.style.color = "#6b6b6b";
      none.style.marginBottom = "6px";
      box.appendChild(none);
    }

    arr.forEach((a) => {
      const row = document.createElement("div");
      row.className = "alert-row";
      row.style.padding = "10px";
      row.style.background = "rgba(255,255,255,0.12)";
      row.style.borderRadius = "8px";
      row.style.marginBottom = "8px";

      row.innerHTML = `
        <b>Node ${a.nodeId || "?"}</b> —
        PFFI: ${a.pffi ?? "—"}
        MQ2: ${a.mq2 ?? "—"}
        MQ135: ${a.mq135 ?? "—"}
        dB: ${a.dB ?? "—"}
        <div style="font-size:0.8rem;color:#777;">
          ${new Date(a.timestamp).toLocaleString()}
        </div>
      `;
      box.appendChild(row);
    });

    container.appendChild(box);
  }

  block("🔥 Fire Alerts", groups.fire, "#e74c3c");
  block("🌫 Air / Gas Alerts", groups.gas, "#ff9f43");
  block("🔊 Acoustic Alerts", groups.acoustic, "#3498db");
}

function renderLogs(logs) {
  const container = document.getElementById("logs-list");
  if (!logs || !logs.length) {
    container.innerHTML =
      "<div style='color:#6b6b6b'>No logs yet</div>";
    return;
  }
  container.innerHTML = "";
  logs.slice(0, 200).forEach((l) => {
    const el = document.createElement("div");
    el.style.padding = "6px";
    el.style.borderBottom = "1px solid rgba(0,0,0,0.04)";
    el.textContent = `[${new Date(l.ts).toLocaleTimeString()}] ${l.msg}`;
    container.appendChild(el);
  });
}

// -------- Gauges from state -----------
function updateGaugesFromState(state) {
  const nodes = state.nodes || {};
  const keys = Object.keys(nodes);
  if (!keys.length) {
    Object.keys(gauges).forEach((id) => {
      gauges[id] && gauges[id].setValue("--", "#ddd");
    });
    return;
  }
  const primary = nodes[keys[0]].latest || nodes[keys[0]];

  if (gauges["gauge-pffi"]) {
    const v = primary.computed?.pffi ?? 0;
    gauges["gauge-pffi"].setValue(v, colorForValue(v));
  }

  if (gauges["gauge-temp"]) {
    const v = primary.temp_c ?? 0;
    const pct = Math.max(0, Math.min(100, Math.round((v / 50) * 100)));
    gauges["gauge-temp"].setValue(pct, colorForValue(pct));
  }

  if (gauges["gauge-hum"]) {
    const v = primary.hum_pct ?? 0;
    gauges["gauge-hum"].setValue(v, colorForValue(100 - v));
  }

  if (gauges["gauge-dB"]) {
    const v = primary.dB ?? 0;
    const pct = Math.min(100, Math.round((v / 120) * 100));
    gauges["gauge-dB"].setValue(pct, colorForValue(pct));
  }

  if (gauges["gauge-aqi"]) {
    const v = primary.mq135 ?? 0;
    const pct = Math.max(0, Math.min(100, Math.round((v / 500) * 100)));
    gauges["gauge-aqi"].setValue(pct, colorForValue(pct));
  }

  if (gauges["gauge-vpd"]) {
    const v = primary.computed?.vpd ?? 0;
    const pct = Math.max(0, Math.min(100, Math.round((v / 4) * 100)));
    gauges["gauge-vpd"].setValue(pct, colorForValue(pct));
  }

  if (gauges["g-heat"]) {
    const v = primary.computed?.hi ?? 0;
    const pct = Math.max(0, Math.min(100, Math.round((v / 60) * 100)));
    gauges["g-heat"].setValue(pct, colorForValue(pct));
  }
  if (gauges["g-dew"]) {
    const v = Math.round(primary.computed?.dp ?? 0);
    const pct = Math.max(0, Math.min(100, Math.round((v / 30) * 100)));
    gauges["g-dew"].setValue(pct, colorForValue(pct));
  }
  if (gauges["g-fmi"]) {
    const v = Math.max(0, Math.min(100, Math.round(100 - (primary.hum_pct ?? 0))));
    gauges["g-fmi"].setValue(v, colorForValue(v));
  }

  if (gauges["g-mq2"]) {
    const v = primary.mq2 ?? 0;
    const pct = Math.max(0, Math.min(100, Math.round((v / 500) * 100)));
    gauges["g-mq2"].setValue(pct, colorForValue(pct));
  }
  if (gauges["g-mq135"]) {
    const v = primary.mq135 ?? 0;
    const pct = Math.max(0, Math.min(100, Math.round((v / 500) * 100)));
    gauges["g-mq135"].setValue(pct, colorForValue(pct));
  }
  if (gauges["g-aqi2"]) {
    const v = primary.mq135 ?? 0;
    const pct = Math.max(0, Math.min(100, Math.round((v / 500) * 100)));
    gauges["g-aqi2"].setValue(pct, colorForValue(pct));
  }

  if (gauges["g-noise-env"]) {
    const v = primary.dB ?? 0;
    const pct = Math.min(100, Math.round((v / 120) * 100));
    gauges["g-noise-env"].setValue(pct, colorForValue(pct));
  }
  if (gauges["g-wildlife"]) {
    const v = primary.wildlife_count ?? 0;
    gauges["g-wildlife"].setValue(Math.min(100, v), colorForValue(v));
  }
  if (gauges["g-threat"]) {
    const v = primary.sound_confidence ?? 0;
    gauges["g-threat"].setValue(Math.min(100, v), colorForValue(v));
  }
}


// -----------------------------------------------------
// 3. GRAPHS (Chart.js) — now fed by realtime rows
// -----------------------------------------------------
let chartTemp, chartHum, chartGas, chartNoise;

function createGraph(canvasId, label, color) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label,
        data: [],
        borderColor: color,
        backgroundColor: color + "33",
        borderWidth: 2,
        tension: 0.35,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { maxTicksLimit: 6 } },
        y: { beginAtZero: true }
      }
    }
  });
}

function initGraphs() {
  if (document.getElementById("graph-temp")) {
    chartTemp = createGraph("graph-temp", "Temperature °C", "#e67e22");
    chartHum = createGraph("graph-hum", "Humidity %", "#3498db");
    chartGas = createGraph("graph-gas", "Gas Sensor", "#9b59b6");
    chartNoise = createGraph("graph-noise", "Noise dB", "#e74c3c");
  }
}

function updateGraphsFromRow(row) {
  if (!chartTemp) return;
  const ts = new Date(row.ts).toLocaleTimeString();

  const pushData = (chart, value) => {
    chart.data.labels.push(ts);
    chart.data.datasets[0].data.push(value);
    if (chart.data.labels.length > 24) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }
    chart.update();
  };

  pushData(chartTemp, row.temp_c || 0);
  pushData(chartHum, row.hum_pct || 0);
  // use MQ135 as gas metric
  pushData(chartGas, row.mq135 || 0);
  pushData(chartNoise, row.db || 0);
}


// -----------------------------------------------------
// 4. STATE MERGE + UI REFRESH
// -----------------------------------------------------
function mergeRowIntoState(row) {
  const nodeKey = `${row.zone_id}/${row.node_id}`;

  const latest = {
    zoneId: row.zone_id,
    nodeId: row.node_id,
    temp_c: row.temp_c,
    hum_pct: row.hum_pct,
    mq2: row.mq2,
    mq135: row.mq135,
    flame1: row.flame1,
    flame2: row.flame2,
    dB: row.db,
    sound_type: row.sound_type,
    sound_confidence: row.sound_confidence,
    battery_pct: row.battery_pct,
    timestamp: Math.floor(new Date(row.ts).getTime() / 1000),
    computed: {
      dp: row.dp,
      vpd: row.vpd,
      hi: row.hi,
      pffi: row.pffi
    }
  };
  // 🔥 Detect flame instantly
if (row.flame1 === 1 || row.flame2 === 1) {
    handleFlameTrigger(nodeKey);
}


  if (!lastState.nodes[nodeKey]) {
    lastState.nodes[nodeKey] = { latest };
  } else {
    lastState.nodes[nodeKey].latest = latest;
  }

  // Logs
  const tsMs = new Date(row.ts).getTime();
  lastState.logs.unshift({
    ts: tsMs,
    msg: `Node ${latest.nodeId} updated`
  });
  if (lastState.logs.length > 200) lastState.logs.pop();

  // Alerts: simple rule
  const alertObj = {
    nodeId: latest.nodeId,
    pffi: latest.computed.pffi,
    mq2: latest.mq2,
    mq135: latest.mq135,
    dB: latest.dB,
    sound_confidence: latest.sound_confidence,
    timestamp: tsMs
  };

  if (
    alertObj.pffi >= 70 ||
    alertObj.mq2 >= 250 ||
    alertObj.dB >= 95 ||
    alertObj.sound_confidence >= 50
  ) {
    lastState.alerts.unshift(alertObj);
    if (lastState.alerts.length > 100) lastState.alerts.pop();
  }
}

function refreshUI() {
  setHeaderCounts(lastState.nodes, lastState.alerts);
  updateGaugesFromState(lastState);
  renderNodesTable(lastState.nodes);
  renderAlerts(lastState.alerts);
  renderLogs(lastState.logs);
}


// -----------------------------------------------------
// 5. SUPABASE REALTIME SUBSCRIPTION (NO POLLING)
// -----------------------------------------------------
function handleRealtime(row) {
  console.log("Realtime row:", row);
  mergeRowIntoState(row);
  updateGraphsFromRow(row);
  refreshUI();
  document.getElementById("last-updated").textContent =
    `Last updated — ${new Date().toLocaleTimeString()}`;
}

// subscribe to changes on forest_telemetry
const channel = sb
  .channel("forest_updates")
  .on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "forest_telemetry" },
    (payload) => {
      handleRealtime(payload.new);
    }
  )
  .subscribe();


// -----------------------------------------------------
// 6. INITIAL LOAD (ONE-TIME FETCH, STILL NOT POLLING)
// -----------------------------------------------------
async function loadInitialState() {
  try {
    const { data, error } = await sb
      .from("forest_telemetry")
      .select("*")
      .order("ts", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Initial load error:", error);
      return;
    }

    lastState = { nodes: {}, alerts: [], logs: [] };

    // oldest → newest to build history correctly
    data.slice().reverse().forEach((row) => {
      mergeRowIntoState(row);
      updateGraphsFromRow(row);
    });

    refreshUI();
    document.getElementById("last-updated").textContent =
      `Last updated — ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error("loadInitialState error:", err);
  }
}


// -----------------------------------------------------
// 7. NAV, FILTERS, CLOCK, BOOTSTRAP
// -----------------------------------------------------
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("filter-btn")) {
    document.querySelectorAll(".filter-btn")
      .forEach((btn) => btn.classList.remove("active"));
    e.target.classList.add("active");
    selectedFilter = e.target.dataset.filter;
    renderNodesTable(lastState.nodes || {});
  }
});

// navigation buttons
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((x) =>
      x.classList.remove("active")
    );
    btn.classList.add("active");
    document.querySelectorAll(".page").forEach((p) =>
      p.classList.remove("active")
    );
    const id = `page-${btn.dataset.page}`;
    document.getElementById(id).classList.add("active");
  });
});

// refresh button → re-load from Supabase (still not polling)
const refreshBtn = document.getElementById("refreshBtn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => loadInitialState());
}

// modal close (if you use it later)
document
  .getElementById("modal-close")
  ?.addEventListener("click", () =>
    document.getElementById("modal").classList.add("hidden")
  );

// clock
function updateClock() {
  const now = new Date();
  const timeString = now.toLocaleTimeString("en-IN", {
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const c = document.getElementById("clock");
  if (c) c.innerText = timeString;
}
setInterval(updateClock, 1000);
updateClock();

// bootstrapping
window.addEventListener("load", () => {
  initGauges();
  initGraphs();
  loadInitialState(); // ONE TIME
});

