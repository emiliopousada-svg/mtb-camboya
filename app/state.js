'use strict';

//  ESTADO GLOBAL
// ============================================================
let map = null, userMarker = null, routePolyline = null, savedRouteLayer = null, offlineTileLayer = null;
let activeMapStyle = null, mapStyleLayers = {};
let isRecording = false, isPaused = false;
let autoPaused = false, autoPauseInterval = null;
let autoPauseAnchor = null, autoPauseLastPosition = null, autoPauseLastMovementAt = null;
let recordingActivityType = 'mtb', preferredActivityType = 'mtb';
try {
    const storedActivity = localStorage.getItem('mtb_activity_type');
    if (Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, storedActivity)) preferredActivityType = storedActivity;
} catch (e) {}
let movingMs = 0, segStart = null, timerInterval = null, draftInterval = null;
let totalDistance = 0, elev = makeElevTracker();
let points = [], segments = [], lastAccepted = null, resumeBreak = false, startedAt = null;
let lastLat = null, lastLon = null, lastAccuracy = null, following = true, firstFix = false, lastPosSave = 0;
let lastHeading = null; // Último rumbo GPS válido; se conserva al detenerse.
let lastCourseFix = null; // Posición de referencia para calcular el rumbo si el GPS nativo no lo da.
let currentHr = null;
let currentCadence = null, currentPower = null, currentBleSpeed = null, currentBleSpeedAt = 0;
let lastCscReading = null;
let rideBattery = null, nativeBatteryInfo = null, batteryCheckInterval = null;
let rideAdvisoryToken = 0, batteryPollAt = 0;
const batteryWarnings = new Set();
let mapRotationEnabled = true;
let savedRoutes = [];
let followedRoute = null, offRouteState = false;
let routeProfileCoords = [], routeProfilePointCount = 0;
let offRouteAudioContext = null;
let statsPeriod = 'semanal';
let statsChart = null;

const btnStart = $('btn-start'), btnStop = $('btn-stop');
const lblStart = $('lbl-start'), icoStart = $('ico-start');

let activityPickerOpen = false, activityPickerChoice = 'mtb', activityPickerSavesPreference = true, resolveActivityPicker = null;
const activityPicker = $('activity-picker');

function finishActivityPicker(choice) {
    if (!activityPickerOpen) return;
    activityPickerOpen = false;
    activityPicker.hidden = true;
    const resolve = resolveActivityPicker;
    resolveActivityPicker = null;
    btnStart.focus();
    if (resolve) resolve(choice);
}

function openActivityPicker(initialType = preferredActivityType, savePreference = true, purpose = 'record') {
    if (activityPickerOpen) return Promise.resolve(null);
    activityPickerOpen = true;
    activityPickerChoice = Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, initialType) ? initialType : 'mtb';
    activityPickerSavesPreference = savePreference;
    $('activity-picker-title').textContent = purpose === 'classification'
        ? 'Clasificar ruta por actividad'
        : purpose === 'import' ? 'Actividad del track importado' : '¿Qué actividad vas a hacer?';
    activityPicker.querySelector('p').textContent = purpose === 'classification'
        ? 'Elige la actividad que corresponde a esta ruta.'
        : purpose === 'import' ? 'Elige para qué actividad es este track.'
        : 'Selecciona el tipo de actividad antes de empezar a grabar.';
    $('activity-confirm').textContent = purpose === 'record' ? 'Empezar ruta' : purpose === 'import' ? 'Almacenar' : 'Guardar';
    activityPicker.hidden = false;
    activityPicker.querySelectorAll('[data-activity]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.activity === activityPickerChoice));
    });
    activityPicker.querySelector(`[data-activity="${activityPickerChoice}"]`).focus();

    return new Promise(resolve => { resolveActivityPicker = resolve; });
}

activityPicker.addEventListener('click', event => {
    const option = event.target.closest('[data-activity]');
    if (option) {
        activityPickerChoice = option.dataset.activity;
        activityPicker.querySelectorAll('[data-activity]').forEach(button => {
            button.setAttribute('aria-pressed', String(button === option));
        });
    } else if (event.target.id === 'activity-confirm') {
        if (activityPickerSavesPreference) {
            preferredActivityType = activityPickerChoice;
            try { localStorage.setItem('mtb_activity_type', preferredActivityType); }
            catch (e) { console.warn('No se pudo guardar la actividad preferida:', e); }
        }
        finishActivityPicker(activityPickerChoice);
    } else if (event.target.id === 'activity-cancel' || event.target === activityPicker) {
        finishActivityPicker(null);
    }
});

activityPicker.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        event.preventDefault();
        finishActivityPicker(null);
    }
});

// ============================================================
