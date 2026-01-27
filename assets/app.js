// Front-end editor for _global_variables.json driven by config/variables-config.json
// - Uses ./config/variables-config.json and ./examples/_global_variables.example.json (relative paths)
// - By default, uploaded JSON is merged into a whitelist (config.variables) to avoid unexpected adds/removes
// - Advanced mode allows raw edits and unknown keys to be applied (dangerous for casual users)

const CONFIG_PATH = './config/variables-config.json';
const EXAMPLE_PATH = './examples/_global_variables.example.json';

const fileInput = document.getElementById('fileInput');
const controlsEl = document.getElementById('controls');
const jsonPreview = document.getElementById('jsonPreview');
const rawEditor = document.getElementById('rawEditor');
const applyRaw = document.getElementById('applyRaw');
const downloadBtn = document.getElementById('downloadBtn');
const loadExample = document.getElementById('loadExample');
const resetBtn = document.getElementById('resetBtn');
const status = document.getElementById('status');
const uploadWarning = document.getElementById('uploadWarning');
const pageTitle = document.getElementById('pageTitle');
const advancedToggle = document.getElementById('advancedToggle');

let config = { variables: {} };
let variables = {}; // current object produced from controls or raw
let original = null;

async function loadConfig(){
  try{
    const res = await fetch(CONFIG_PATH);
    if(!res.ok) throw new Error('Failed to load config');
    config = await res.json();
    // Normalise config shape: allow either old flat map or new { variables: {...} }
    if(!config.variables){
      // If the config file was the older format (flat map keyed by $var),
      // wrap it so we always use config.variables internally.
      const copy = {};
      Object.keys(config).forEach(k => {
        if(k === 'pageName') return;
        copy[k] = config[k];
      });
      config = {
        pageName: config.pageName || 'Déesse UI — _global_variables.json editor',
        variables: Object.keys(copy).length ? copy : {}
      };
    }
    pageTitle.textContent = config.pageName || pageTitle.textContent;
    console.log('Loaded config', config);
  }catch(e){
    console.warn('Could not load config/variables-config.json — using empty config. Error:', e);
    config = { pageName: 'Déesse UI — _global_variables.json editor', variables: {}};
  }
}

function setStatus(text){
  status.textContent = text;
}

function updatePreview(){
  jsonPreview.value = JSON.stringify(variables, null, 2);
  // raw editor shows all variables (including unknowns when advanced mode was used)
  rawEditor.value = JSON.stringify(variables, null, 2);
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

function defaultFor(desc){
  if(desc && desc.default !== undefined) return desc.default;
  if(desc && desc.type === 'boolean') return false;
  if(desc && desc.type === 'number') return 0;
  if(desc && desc.type === 'number_array') return Array(desc.count || 2).fill(0);
  if(desc && desc.type === 'string') return '';
  return null;
}

function makeControl(key, value, desc){
  const row = document.createElement('div');
  row.className = 'control-row';
  const label = document.createElement('label');
  label.innerHTML = `<span class="key">${key}</span><div class="help">${desc && desc.label ? desc.label : ''}</div>`;
  if(desc && desc.help){
    label.innerHTML += `<div class="help">${desc.help}</div>`;
  }
  row.appendChild(label);

  const right = document.createElement('div');
  right.className = 'right';

  const readonly = desc && desc.readonly;

  if(desc && desc.type === 'boolean'){
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    input.disabled = !!readonly;
    input.addEventListener('change', () => {
      variables[key] = input.checked;
      updatePreview();
    });
    right.appendChild(input);
  } else if(desc && desc.type === 'number' && desc.input === 'slider'){
    const range = document.createElement('input');
    range.type = 'range';
    range.min = desc.min ?? 0;
    range.max = desc.max ?? 100;
    range.step = desc.step ?? 1;
    range.value = Number(value ?? desc.min ?? 0);
    range.disabled = !!readonly;

    const number = document.createElement('input');
    number.type = 'number';
    number.min = range.min; number.max = range.max; number.step = range.step;
    number.value = range.value;
    number.disabled = !!readonly;

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
      num.disabled = !!readonly;
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
    // default: text/number/manual
    const input = document.createElement('input');
    const isNumber = desc && desc.type === 'number';
    input.type = isNumber ? 'number' : 'text';
    input.value = (typeof value === 'object' && value !== null) ? JSON.stringify(value) : String(value ?? '');
    input.disabled = !!readonly;
    input.addEventListener('input', () => {
      let val;
      if(isNumber) val = (input.value === '') ? null : Number(input.value);
      else val = input.value;
      variables[key] = val;
      updatePreview();
    });
    right.appendChild(input);
  }

  if(desc && desc.readonly){
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'readonly';
    right.appendChild(badge);
  }

  row.appendChild(right);
  return row;
}

function renderControlsForVariables(vars){
  controlsEl.innerHTML = '';
  const configVars = Object.keys(config.variables || {});
  if(configVars.length === 0){
    controlsEl.textContent = 'No variables are configured in config/variables-config.json.';
    return;
  }
  configVars.forEach(key => {
    const desc = config.variables[key] || {};
    const val = vars[key] !== undefined ? vars[key] : defaultFor(desc);
    const control = makeControl(key, val, desc || {});
    controlsEl.appendChild(control);
  });

  // If there are keys present in vars but not in config, show a note (ignored keys)
  const extraKeys = Object.keys(vars).filter(k => !configVars.includes(k));
  if(extraKeys.length){
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<strong>Extra keys present in loaded JSON</strong><div class="help">The uploaded JSON included ${extraKeys.length} key(s) that are not configured and will be ignored by default: <code>${extraKeys.join(', ')}</code>. Enable advanced mode to accept unknown keys.</div>`;
    controlsEl.appendChild(card);
  }
}

function buildSanitizedVariablesFromUpload(uploaded){
  // Build an object containing only keys present in config.variables.
  const out = {};
  const configVars = config.variables || {};
  Object.keys(configVars).forEach(k => {
    if(uploaded && Object.prototype.hasOwnProperty.call(uploaded, k)){
      out[k] = uploaded[k];
    } else {
      out[k] = defaultFor(configVars[k]);
    }
  });
  return out;
}

function applyVariables(obj, { fromUpload = false, allowUnknown = false } = {}){
  if(fromUpload && config && config.variables && Object.keys(config.variables).length > 0 && !allowUnknown){
    // sanitize: only take keys from config.variables
    const sanitized = buildSanitizedVariablesFromUpload(obj);
    variables = structuredClone(sanitized);
    // compute ignored keys for message
    const ignored = Object.keys(obj).filter(k => !Object.prototype.hasOwnProperty.call(config.variables, k));
    if(ignored.length){
      uploadWarning.textContent = `Ignored ${ignored.length} key(s) from uploaded JSON: ${ignored.join(', ')}. Enable advanced mode to include them.`;
    } else {
      uploadWarning.textContent = '';
    }
  } else {
    // advanced: accept everything in object as-is
    variables = structuredClone(obj);
    uploadWarning.textContent = '';
  }

  original = structuredClone(variables);
  renderControlsForVariables(variables);
  updatePreview();
  setStatus('File loaded. Edit controls or raw JSON, then download.');
}

fileInput.addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  if(!f) return;
  const txt = await f.text();
  try{
    const obj = JSON.parse(txt);
    const allowUnknown = advancedToggle.checked;
    applyVariables(obj, { fromUpload: true, allowUnknown });
  }catch(e){
    alert('Invalid JSON file.');
  }
});

loadExample.addEventListener('click', async () => {
  try{
    const res = await fetch(EXAMPLE_PATH);
    if(!res.ok) throw new Error('No example file');
    const obj = await res.json();
    applyVariables(obj, { fromUpload: true, allowUnknown: false });
  }catch(e){
    alert('Could not load example from ' + EXAMPLE_PATH + ' — you can still paste raw JSON.');
  }
});

applyRaw.addEventListener('click', () => {
  try{
    const parsed = JSON.parse(rawEditor.value);
    const allowUnknown = advancedToggle.checked;
    if(!allowUnknown){
      // sanitize
      applyVariables(parsed, { fromUpload: true, allowUnknown: false });
    } else {
      applyVariables(parsed, { fromUpload: true, allowUnknown: true });
    }
  }catch(e){
    alert('Invalid JSON in raw editor.');
  }
});

jsonPreview.addEventListener('input', () => {
  // readonly preview; keep it non-editable. We keep the event handler for safety but it's readonly.
});

downloadBtn.addEventListener('click', downloadJSON);

resetBtn.addEventListener('click', () => {
  if(!original) return;
  applyVariables(original, { fromUpload: false, allowUnknown: advancedToggle.checked });
});

advancedToggle.addEventListener('change', () => {
  const msg = advancedToggle.checked
    ? 'Advanced mode ON — raw edits/unknown keys are allowed. Be careful!'
    : 'Advanced mode OFF — only configured keys will be accepted from uploads/raw JSON.';
  setStatus(msg);
});

async function init(){
  await loadConfig();
  setStatus('Ready. Load a _global_variables.json to begin.');
  // silent prefetch example (no-op if missing)
  try{
    const r = await fetch(EXAMPLE_PATH);
    if(r.ok) {
      // nothing to do
    }
  }catch(e){}
}

init();
