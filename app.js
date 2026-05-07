const MAX_POINTS = 20;

const state = {
  tempHistory: [],
  humHistory: [],
  pressureHistory: [],
  airHistory: [],
  labels: [],
  latestData: null,
  settings: {
    stationName: "Estacion principal",
    refreshRate: 10,
    connectionMode: "sim",
    wsUrl: "ws://192.168.1.120:81",
    themeMode: "night",
    sidebarCollapsed: false,
  },
  thresholds: {
    tempMax: 32,
    humMin: 25,
  },
  stations: ["Estacion principal", "Invernadero", "Azotea"],
  activeStation: "Estacion principal",
  connection: {
    ws: null,
    reconnectTimer: null,
    attempts: 0,
    shouldReconnect: false,
  },
};

const storageKeys = {
  auth: "meteo_auth",
  settings: "meteo_settings",
  thresholds: "meteo_thresholds",
  stations: "meteo_stations",
  activeStation: "meteo_active_station",
};

const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");
const tempValue = document.getElementById("temp-value");
const humValue = document.getElementById("hum-value");
const presValue = document.getElementById("pres-value");
const airValue = document.getElementById("air-value");
const tempTrend = document.getElementById("temp-trend");
const humTrend = document.getElementById("hum-trend");
const presTrend = document.getElementById("pres-trend");
const airTrend = document.getElementById("air-trend");
const alertsList = document.getElementById("alerts-list");
const lastUpdate = document.getElementById("last-update");
const liveClock = document.getElementById("live-clock");
const weatherSummary = document.getElementById("weather-summary");
const windValue = document.getElementById("wind-value");
const rainValue = document.getElementById("rain-value");
const activityList = document.getElementById("activity-list");
const stationSwitcher = document.getElementById("station-switcher");
const stationList = document.getElementById("station-list");
const connectionStatusText = document.getElementById("connection-status-text");
const toastContainer = document.getElementById("toast-container");
const metricModal = document.getElementById("metric-modal");
const modalTitle = document.getElementById("modal-title");
const modalMainValue = document.getElementById("modal-main-value");
const modalContext = document.getElementById("modal-context");
const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");

let timerId = null;
let clockTimerId = null;
let tempChart = null;
let comboChart = null;
let pressureChart = null;
let activityItems = [];

function init() {
  loadPersisted();
  mountAuthHandlers();
  mountDashboardHandlers();
  renderStationUI();
  toggleView(Boolean(localStorage.getItem(storageKeys.auth)));
}

function loadPersisted() {
  const savedSettings = localStorage.getItem(storageKeys.settings);
  const savedThresholds = localStorage.getItem(storageKeys.thresholds);
  const savedStations = localStorage.getItem(storageKeys.stations);
  const savedActiveStation = localStorage.getItem(storageKeys.activeStation);

  if (savedSettings) state.settings = JSON.parse(savedSettings);
  if (savedThresholds) state.thresholds = JSON.parse(savedThresholds);
  if (savedStations) state.stations = JSON.parse(savedStations);
  if (savedActiveStation) state.activeStation = savedActiveStation;

  state.settings.themeMode = state.settings.themeMode || "night";
  state.settings.sidebarCollapsed = Boolean(state.settings.sidebarCollapsed);

  syncSettingsInputs();
  updateStationBrand();
}

function syncSettingsInputs() {
  document.getElementById("station-name").value = state.settings.stationName;
  document.getElementById("refresh-rate").value = state.settings.refreshRate;
  document.getElementById("temp-max").value = state.thresholds.tempMax;
  document.getElementById("hum-min").value = state.thresholds.humMin;
  document.getElementById("connection-mode").value = state.settings.connectionMode;
  document.getElementById("theme-mode").value = state.settings.themeMode;
  document.getElementById("ws-url").value = state.settings.wsUrl;
  applyTheme();
  applySidebarMode();
}

function mountAuthHandlers() {
  const loginForm = document.getElementById("login-form");
  const logoutBtn = document.getElementById("logout-btn");

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    if (!email || password.length < 4) {
      toast("Credenciales invalidas", "err");
      return;
    }
    localStorage.setItem(storageKeys.auth, email);
    toggleView(true);
    toast("Sesion iniciada", "ok");
  });

  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem(storageKeys.auth);
    toggleView(false);
    toast("Sesion cerrada", "warn");
  });
}

function mountDashboardHandlers() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      showSection(button.dataset.section);
    });
  });

  document.getElementById("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.stationName = document.getElementById("station-name").value.trim() || "Estacion principal";
    state.settings.refreshRate = Number(document.getElementById("refresh-rate").value) || 10;
    state.settings.connectionMode = document.getElementById("connection-mode").value;
    state.settings.themeMode = document.getElementById("theme-mode").value;
    state.settings.wsUrl = document.getElementById("ws-url").value.trim() || "ws://192.168.1.120:81";
    localStorage.setItem(storageKeys.settings, JSON.stringify(state.settings));
    applyTheme();
    updateStationBrand();
    restartDataEngine();
    toast("Configuracion guardada", "ok");
  });

  document.getElementById("threshold-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.thresholds.tempMax = Number(document.getElementById("temp-max").value) || 32;
    state.thresholds.humMin = Number(document.getElementById("hum-min").value) || 25;
    localStorage.setItem(storageKeys.thresholds, JSON.stringify(state.thresholds));
    toast("Umbrales actualizados", "ok");
  });

  document.getElementById("station-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("new-station-name");
    const name = input.value.trim();
    if (!name) return;
    if (state.stations.includes(name)) {
      toast("Esa estacion ya existe", "warn");
      return;
    }
    state.stations.push(name);
    persistStations();
    renderStationUI();
    input.value = "";
    toast("Estacion agregada", "ok");
  });

  stationSwitcher.addEventListener("change", (event) => {
    state.activeStation = event.target.value;
    localStorage.setItem(storageKeys.activeStation, state.activeStation);
    updateStationBrand();
    toast(`Estacion activa: ${state.activeStation}`, "ok");
  });

  document.querySelectorAll(".metric-clickable").forEach((card) => {
    card.addEventListener("click", () => openMetricModal(card.dataset.metric));
  });

  document.getElementById("close-modal-btn").addEventListener("click", () => metricModal.close());
  document.getElementById("export-csv-btn").addEventListener("click", exportCsvData);
  sidebarToggleBtn.addEventListener("click", () => {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    localStorage.setItem(storageKeys.settings, JSON.stringify(state.settings));
    applySidebarMode();
  });
}

function toggleView(isAuthenticated) {
  loginView.classList.toggle("active", !isAuthenticated);
  dashboardView.classList.toggle("active", isAuthenticated);
  if (isAuthenticated) {
    bootCharts();
    startClock();
    startDataEngine();
  } else {
    stopClock();
    stopDataEngine();
    destroyCharts();
  }
}

function showSection(sectionId) {
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.toggle("active", section.id === sectionId);
  });
}

function startDataEngine() {
  stopDataEngine();
  seedData();
  renderFrame();
  if (state.settings.connectionMode === "ws") {
    state.connection.shouldReconnect = true;
    connectWebSocket();
  } else {
    state.connection.shouldReconnect = false;
    connectionStatusText.textContent = "ESP32 online (simulado)";
    timerId = setInterval(renderFrame, Math.max(5000, state.settings.refreshRate * 1000));
  }
}

function stopDataEngine() {
  state.connection.shouldReconnect = false;
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  disconnectWebSocket();
}

function restartDataEngine() {
  stopDataEngine();
  startDataEngine();
}

function connectWebSocket() {
  disconnectWebSocket();
  connectionStatusText.textContent = "Conectando por WebSocket...";
  try {
    const ws = new WebSocket(state.settings.wsUrl);
    state.connection.ws = ws;
    ws.addEventListener("open", () => {
      state.connection.attempts = 0;
      connectionStatusText.textContent = "ESP32 online (WebSocket)";
      toast("Conexion WebSocket establecida", "ok");
    });
    ws.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data);
        renderFrame(parsed);
      } catch (error) {
        renderFrame();
      }
    });
    ws.addEventListener("error", () => {
      connectionStatusText.textContent = "Error WebSocket. Reintentando...";
    });
    ws.addEventListener("close", () => {
      scheduleReconnect();
    });
  } catch (error) {
    scheduleReconnect();
  }
}

function disconnectWebSocket() {
  if (state.connection.ws) {
    state.connection.ws.close();
    state.connection.ws = null;
  }
  if (state.connection.reconnectTimer) {
    clearTimeout(state.connection.reconnectTimer);
    state.connection.reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!state.connection.shouldReconnect || state.settings.connectionMode !== "ws") return;
  state.connection.attempts += 1;
  const wait = Math.min(12000, 1500 * state.connection.attempts);
  connectionStatusText.textContent = `Desconectado. Reintento en ${Math.round(wait / 1000)}s`;
  state.connection.reconnectTimer = setTimeout(connectWebSocket, wait);
}

function startClock() {
  stopClock();
  updateClock();
  clockTimerId = setInterval(updateClock, 1000);
}

function stopClock() {
  if (clockTimerId) {
    clearInterval(clockTimerId);
    clockTimerId = null;
  }
}

function updateClock() {
  liveClock.textContent = new Date().toLocaleTimeString("es-ES");
}

function bootCharts() {
  if (tempChart && comboChart && pressureChart) return;
  const chartCommon = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        labels: { color: "#c2d2e8" },
      },
    },
    scales: {
      x: {
        ticks: { color: "#8ea0b8" },
        grid: { color: "rgba(255,255,255,0.06)" },
      },
      y: {
        ticks: { color: "#8ea0b8" },
        grid: { color: "rgba(255,255,255,0.06)" },
      },
    },
  };

  tempChart = new Chart(document.getElementById("temp-chart"), {
    type: "line",
    data: { labels: state.labels, datasets: [{ label: "Temp", data: state.tempHistory, borderColor: "#4f8cff", backgroundColor: "rgba(79,140,255,0.18)", fill: true, tension: 0.3 }] },
    options: chartCommon,
  });

  comboChart = new Chart(document.getElementById("combo-chart"), {
    data: {
      labels: state.labels,
      datasets: [
        { type: "line", label: "Temp C", data: state.tempHistory, borderColor: "#4f8cff", tension: 0.3 },
        { type: "bar", label: "Hum %", data: state.humHistory, backgroundColor: "rgba(16,185,129,0.35)", borderColor: "#10b981" },
      ],
    },
    options: chartCommon,
  });

  pressureChart = new Chart(document.getElementById("pressure-chart"), {
    type: "line",
    data: { labels: state.labels, datasets: [{ label: "Presion hPa", data: state.pressureHistory, borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.15)", fill: true, tension: 0.25 }] },
    options: chartCommon,
  });
}

function destroyCharts() {
  if (tempChart) tempChart.destroy();
  if (comboChart) comboChart.destroy();
  if (pressureChart) pressureChart.destroy();
  tempChart = null;
  comboChart = null;
  pressureChart = null;
}

function seedData() {
  if (state.labels.length > 0) return;
  for (let i = 0; i < 12; i += 1) {
    pushData(fakeSensorData());
  }
}

function renderFrame(incomingData) {
  const data = normalizeSensorData(incomingData || fakeSensorData());
  state.latestData = data;
  pushData(data);
  updateMetrics(data);
  updateWeatherSummary(data);
  updateActivity(data);
  updateAlerts(data);
  updateCharts();
  lastUpdate.textContent = `Ultima actualizacion: ${new Date().toLocaleTimeString("es-ES")}`;
}

function normalizeSensorData(data) {
  return {
    temp: Number(data.temp ?? data.temperature ?? 20),
    hum: Number(data.hum ?? data.humidity ?? 40),
    pressure: Number(data.pressure ?? data.pres ?? 1000),
    air: Number(data.air ?? data.aqi ?? 60),
    wind: Number(data.wind ?? 5),
    rain: Number(data.rain ?? 0),
  };
}

function pushData(data) {
  const timestamp = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  state.labels.push(timestamp);
  state.tempHistory.push(data.temp);
  state.humHistory.push(data.hum);
  state.pressureHistory.push(data.pressure);
  state.airHistory.push(data.air);
  if (state.labels.length > MAX_POINTS) {
    state.labels.shift();
    state.tempHistory.shift();
    state.humHistory.shift();
    state.pressureHistory.shift();
    state.airHistory.shift();
  }
}

function updateMetrics(data) {
  const prevTemp = state.tempHistory.at(-2);
  const prevHum = state.humHistory.at(-2);
  const prevPressure = state.pressureHistory.at(-2);
  const prevAir = state.airHistory.at(-2);

  tempValue.textContent = data.temp.toFixed(1);
  humValue.textContent = data.hum.toFixed(0);
  presValue.textContent = data.pressure.toFixed(1);
  airValue.textContent = data.air.toFixed(0);

  renderTrend(tempTrend, data.temp, prevTemp, "C");
  renderTrend(humTrend, data.hum, prevHum, "%");
  renderTrend(presTrend, data.pressure, prevPressure, "hPa");
  renderTrend(airTrend, data.air, prevAir, "AQI");
}

function renderTrend(element, current, previous, unit) {
  if (!Number.isFinite(previous)) {
    element.textContent = "Sin variacion";
    element.classList.remove("up", "down");
    return;
  }

  const delta = current - previous;
  const absDelta = Math.abs(delta);
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "";
  const symbol = delta > 0 ? "Sube" : delta < 0 ? "Baja" : "Igual";
  element.textContent = `${symbol} ${absDelta.toFixed(1)} ${unit}`;
  element.classList.remove("up", "down");
  if (direction) element.classList.add(direction);
}

function updateCharts() {
  if (!tempChart || !comboChart || !pressureChart) return;
  tempChart.update("none");
  comboChart.update("none");
  pressureChart.update("none");
}

function updateWeatherSummary(data) {
  let summary = "Ambiente estable";
  if (data.temp > 30) summary = "Dia caluroso";
  else if (data.temp < 16) summary = "Ambiente fresco";
  if (data.rain > 1.5) summary = `${summary} con lluvia`;
  weatherSummary.textContent = summary;
  windValue.textContent = `Viento: ${data.wind.toFixed(1)} km/h`;
  rainValue.textContent = `Lluvia: ${data.rain.toFixed(1)} mm/h`;
}

function updateActivity(data) {
  const item = `${new Date().toLocaleTimeString("es-ES")} - Temp ${data.temp.toFixed(1)} C, Hum ${data.hum.toFixed(0)} %`;
  activityItems.unshift(item);
  activityItems = activityItems.slice(0, 6);
  activityList.innerHTML = "";
  activityItems.forEach((entry) => {
    const li = document.createElement("li");
    li.textContent = entry;
    activityList.appendChild(li);
  });
}

function updateAlerts(data) {
  const alerts = [];
  if (data.temp > state.thresholds.tempMax) alerts.push(`Temperatura alta: ${data.temp.toFixed(1)} C`);
  if (data.hum < state.thresholds.humMin) alerts.push(`Humedad baja: ${data.hum.toFixed(0)} %`);
  if (data.air > 120) alerts.push(`Calidad de aire comprometida: AQI ${data.air.toFixed(0)}`);

  alertsList.innerHTML = "";
  if (alerts.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Sin alertas. Condiciones estables.";
    li.style.borderColor = "rgba(16,185,129,0.25)";
    li.style.background = "rgba(16,185,129,0.08)";
    li.style.color = "#8ef0c8";
    alertsList.appendChild(li);
    return;
  }
  alerts.forEach((alertText) => {
    const li = document.createElement("li");
    li.textContent = alertText;
    alertsList.appendChild(li);
  });
}

function openMetricModal(metricKey) {
  if (!state.latestData) return;
  const labels = {
    temp: ["Temperatura", `${state.latestData.temp.toFixed(1)} C`, "Confort recomendado: 20 - 26 C"],
    hum: ["Humedad", `${state.latestData.hum.toFixed(0)} %`, "Rango recomendado: 35 - 60 %"],
    pressure: ["Presion", `${state.latestData.pressure.toFixed(1)} hPa`, "Tendencia barometrica en tiempo real"],
    air: ["Calidad de aire", `AQI ${state.latestData.air.toFixed(0)}`, "AQI < 100 ideal para interiores"],
  };
  const [title, value, context] = labels[metricKey];
  modalTitle.textContent = title;
  modalMainValue.textContent = value;
  modalContext.textContent = context;
  metricModal.showModal();
}

function renderStationUI() {
  stationSwitcher.innerHTML = "";
  stationList.innerHTML = "";

  state.stations.forEach((station) => {
    const option = document.createElement("option");
    option.value = station;
    option.textContent = station;
    option.selected = station === state.activeStation;
    stationSwitcher.appendChild(option);

    const li = document.createElement("li");
    li.className = "station-item";
    const label = document.createElement("span");
    label.textContent = station;
    const action = document.createElement("button");
    action.className = "btn btn-ghost";
    action.textContent = station === state.activeStation ? "Activa" : "Activar";
    action.disabled = station === state.activeStation;
    action.addEventListener("click", () => {
      state.activeStation = station;
      localStorage.setItem(storageKeys.activeStation, station);
      renderStationUI();
      updateStationBrand();
      toast(`Cambiada a ${station}`, "ok");
    });
    li.appendChild(label);
    li.appendChild(action);
    stationList.appendChild(li);
  });
}

function updateStationBrand() {
  document.querySelector(".brand p").textContent = state.activeStation;
}

function persistStations() {
  localStorage.setItem(storageKeys.stations, JSON.stringify(state.stations));
}

function applyTheme() {
  document.body.dataset.theme = state.settings.themeMode;
}

function applySidebarMode() {
  document.body.classList.toggle("sidebar-collapsed", Boolean(state.settings.sidebarCollapsed));
  sidebarToggleBtn.textContent = state.settings.sidebarCollapsed ? "Expandir" : "Compactar";
}

function toast(message, type = "ok") {
  const toastNode = document.createElement("div");
  toastNode.className = `toast ${type}`;
  toastNode.textContent = message;
  toastContainer.appendChild(toastNode);
  setTimeout(() => {
    toastNode.remove();
  }, 2600);
}

function exportCsvData() {
  if (state.labels.length === 0) {
    toast("No hay datos para exportar", "warn");
    return;
  }

  const headers = ["timestamp", "temp_c", "hum_pct", "pressure_hpa", "air_aqi", "station"];
  const rows = state.labels.map((label, index) => {
    return [
      label,
      state.tempHistory[index]?.toFixed(2) ?? "",
      state.humHistory[index]?.toFixed(2) ?? "",
      state.pressureHistory[index]?.toFixed(2) ?? "",
      state.airHistory[index]?.toFixed(2) ?? "",
      state.activeStation,
    ].join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeStation = state.activeStation.toLowerCase().replace(/\s+/g, "-");
  anchor.href = url;
  anchor.download = `meteo-${safeStation}-${Date.now()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("CSV exportado", "ok");
}

function fakeSensorData() {
  return {
    temp: 21 + Math.random() * 15,
    hum: 20 + Math.random() * 65,
    pressure: 990 + Math.random() * 30,
    air: 50 + Math.random() * 100,
    wind: 2 + Math.random() * 22,
    rain: Math.random() * 3.2,
  };
}

init();
