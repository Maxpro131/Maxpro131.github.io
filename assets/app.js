// Editor (safe mode): no file upload, no raw edits.
// - Loads config from config/variables-config.json
// - Loads example from examples/_global_variables.example.json (resolved relative to page URL)
// - Uses only keys present in config.variables (unknown keys ignored)
// - Readonly behavior controlled by config.variables[$key].readonly
// - Supports new "choice" input type via either numbered choice_* fields or a "choices" array

const CONFIG_URL = new URL('config/variables-config.json', location.href).href;
const EXAMPLE_URL = new URL('examples/_global_variables.example.json', location.href).href;

const controlsEl = document.getElementById('controls');
const jsonPreview = document.getElementById('jsonPreview');
const downloadBtn = document.getElementById('downloadBtn');
const loadExampleBtn = document.getElementById('loadExample');
const resetBtn = document.getElementById('resetBtn');
const status = document.getElementById('status');
const pageTitle = document.getElementById('pageTitle');

let config = { pageName: 'Déesse UI — Editor', variables: {} };
let variables = {}; // sanitized object shown & downloadable
let defaults = {};  // defaults derived from config and example

async function loadConfig(){
  try {
    const r = await fetch(CONFIG_URL);
    if(!r.ok) throw new Error('Failed to fetch config');
    const raw = await r.json();
    // support both shapes (flat map or { pageName, variables: { ... } })
    if(raw.variables) {
      config = raw;
    } else {
      // old flat map: treat everything as variables, optionally pageName may exist
      const copy = { variables: {} };
      Object.keys(raw).forEach(k => {
        if(k === 'pageName') copy.pageName = raw.pageName;
        else copy.variables[k] = raw[k];
      });
      config = { pageName: copy.pageName || config.pageName, variables: copy.variables };
    }
    pageTitle.textContent = config.pageName || pageTitle.textContent;
    console.log('config loaded', config);
  } catch (e) {
    console.warn('Could not load config, using empty config', e);
    config = { pageName: config.pageName, variables: {} };
  }
}

function defaultFor(desc){
  if(!desc) return null;
  if(desc.default !== undefined) return structuredClone(desc.default);
  if(desc.type === 'boolean') return false;
  if(desc.type === 'number') return 0;
  if(desc.type === 'number_array') return Array(desc.count || 2).fill(0);
  if(desc.type === 'string') return '';
  if(desc.type === 'choice'){
    const choices = getChoices(desc);
    return (choices && choices.length) ? choices[0] : '';
  }
  return null;
}

// Read choices out of the descriptor. Supports:
// - desc.choices: an array of values
// - desc.choice_1, desc.choice_2, ... : numbered keys (preserves numeric order)
function getChoices(desc){
  if(!desc) return [];
  if(Array.isArray(desc.choices)) return desc.choices.map(String);
  const choices = [];
  Object.keys(desc).forEach(k => {
    const m = k.match(/^choice_(\d+)$/);
    if(m){
      choices.push({ idx: Number(m[1]), val: String(desc[k]) });
    }
  });
  if(choices.length){
    choices.sort((a,b)=>a.idx-b.idx);
    return choices.map(c => c.val);
  }
  return [];
}

function makeControl(key, value, desc){
  const row = document.createElement('div');
  row.className = 'control-row';
  const label = document.createElement('label');
  label.innerHTML = `<span class="key">${key}</span><div class="help">${desc && desc.label ? desc.label : ''}</div>`;
  if(desc && desc.help) label.innerHTML += `<div class="help">${desc.help}</div>`;
  row.appendChild(label);

  const right = document.createElement('div');
  right.className = 'right';
  const readonly = !!(desc && desc.readonly);

  if(desc && desc.type === 'boolean'){
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    input.disabled = readonly;
    input.addEventListener('change', () => {
      variables[key] = input.checked;
      updatePreview();
    });
    right.appendChild(input);

  } else if(desc && desc.type === 'choice'){
    // render select dropdown with options
    const choices = getChoices(desc);
    const select = document.createElement('select');
    select.disabled = readonly;
    // Populate options
    choices.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    });
    // If no choices found, fall back to a text input
    if(choices.length === 0){
      const fallback = document.createElement('input');
      fallback.type = 'text';
      fallback.disabled = readonly;
      fallback.value = String(value ?? '');
      fallback.addEventListener('input', () => {
        variables[key] = fallback.value;
        updatePreview();
      });
      right.appendChild(fallback);
    } else {
      // set initial value (desc.default, provided value, or first choice)
      const initial = (value !== undefined && value !== null && String(value) !== '') ? String(value) :
                      (desc.default !== undefined ? String(desc.default) : choices[0]);
      select.value = initial;
      variables[key] = select.value;
      select.addEventListener('change', () => {
        variables[key] = select.value;
        updatePreview();
      });
      right.appendChild(select);
    }

  } else if(desc && desc.type === 'number' && desc.input === 'slider'){
    const range = document.createElement('input');
    range.type = 'range';
    range.min = desc.min ?? 0;
    range.max = desc.max ?? 100;
    range.step = desc.step ?? 1;
    range.value = Number(value ?? desc.min ?? 0);
    range.disabled = readonly;

    const number = document.createElement('input');
    number.type = 'number';
    number.min = range.min; number.max = range.max; number.step = range.step;
    number.value = range.value;
    number.disabled = readonly;

    range.addEventListener('input', () => {
      number.value = range.value;
      variables[key] = Number(range.value);
      updatePreview();
    });
    number.addEventListener('input', () => {
      range.value = number.value;
      variables[key] = Number(number.value);
      updatePreview();
    });

    right.appendChild(range);
    right.appendChild(number);

  } else if(desc && desc.type === 'number_array'){
    const count = desc.count || (Array.isArray(value) ? value.length : 2);
    const container = document.createElement('div');
    container.className = 'array-inputs';
    for(let i=0;i<count;i++){
      const num = document.createElement('input');
      num.type = 'number';
      num.step = desc.step ?? 1;
      num.min = desc.min ?? '';
      num.max = desc.max ?? '';
      num.value = Array.isArray(value) && value[i] !== undefined ? value[i] : 0;
      num.disabled = readonly;
      num.dataset.index = i;
      num.addEventListener('input', () => {
        const idx = Number(num.dataset.index);
        if(!Array.isArray(variables[key])) variables[key] = Array(count).fill(0);
        variables[key][idx] = Number(num.value);
        updatePreview();
      });
      container.appendChild(num);
    }
    right.appendChild(container);

  } else {
    const input = document.createElement('input');
    const isNumber = desc && desc.type === 'number';
    input.type = isNumber ? 'number' : 'text';
    input.value = (typeof value === 'object' && value !== null) ? JSON.stringify(value) : String(value ?? '');
    input.disabled = readonly;
    input.addEventListener('input', () => {
      let val;
      if(isNumber) val = (input.value === '') ? null : Number(input.value);
      else val = input.value;
      variables[key] = val;
      updatePreview();
    });
    right.appendChild(input);
  }

  if(readonly){
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'readonly';
    right.appendChild(badge);
  }

  row.appendChild(right);
  return row;
}

function renderControlsForVariables(){
  controlsEl.innerHTML = '';
  const vars = config.variables || {};
  const keys = Object.keys(vars);
  if(keys.length === 0){
    controlsEl.textContent = 'No variables configured. Add entries to config/variables-config.json';
    return;
  }
  keys.forEach(k => {
    const desc = vars[k] || {};
    const val = variables[k] !== undefined ? variables[k] : defaultFor(desc);
    controlsEl.appendChild(makeControl(k, val, desc));
  });
}

async function loadExampleAndApply(){
  try {
    const r = await fetch(EXAMPLE_URL);
    if(!r.ok) throw new Error('No example file');
    const src = await r.json();
    variables = buildSanitizedFromSource(src);
    defaults = buildSanitizedFromSource(src);
    updatePreview();
    renderControlsForVariables();
    status.textContent = 'Example loaded (sanitized to configured keys).';
  } catch(e) {
    // Fall back to config defaults
    variables = buildSanitizedFromSource(null);
    defaults = buildSanitizedFromSource(null);
    updatePreview();
    renderControlsForVariables();
    status.textContent = 'Could not load example; using config defaults.';
    console.warn('Example load failed', e);
  }
}

// Always return an object with keys from config.variables using source if present,
// otherwise falling back to desc.default or a sensible default.
function buildSanitizedFromSource(source){
  const out = {};
  const vars = config.variables || {};
  Object.keys(vars).forEach(k => {
    if(source && Object.prototype.hasOwnProperty.call(source, k)) {
      out[k] = source[k];
    } else {
      out[k] = defaultFor(vars[k]);
    }
  });
  return out;
}

function resetToDefaults(){
  variables = structuredClone(defaults);
  updatePreview();
  renderControlsForVariables();
  status.textContent = 'Reset to defaults.';
}

function updatePreview(){
  jsonPreview.value = JSON.stringify(variables, null, 2);
}

function downloadJSON(){
  const blob = new Blob([JSON.stringify(variables, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '_global_variables.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

downloadBtn.addEventListener('click', downloadJSON);
loadExampleBtn.addEventListener('click', loadExampleAndApply);
resetBtn.addEventListener('click', resetToDefaults);

async function init(){
  await loadConfig();
  await loadExampleAndApply();
  status.textContent = 'Ready.';
}

init();
