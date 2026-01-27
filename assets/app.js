// Simple front-end editor for _global_variables.json driven by config/variables-config.json
// - Fetches config (map of variable key -> descriptor)
// - Lets user upload a JSON file to populate controls
// - Renders controls per config, keeps live JSON, allows raw edits, and download

const fileInput = document.getElementById('fileInput');
const controlsEl = document.getElementById('controls');
const jsonPreview = document.getElementById('jsonPreview');
const rawEditor = document.getElementById('rawEditor');
const applyRaw = document.getElementById('applyRaw');
const downloadBtn = document.getElementById('downloadBtn');
const loadExample = document.getElementById('loadExample');
const resetBtn = document.getElementById('resetBtn');
const status = document.getElementById('status');

let config = {};
let variables = {}; // current object produced from controls or raw
let original = null;

async function loadConfig(){
  try{
    const res = await fetch('/config/variables-config.json');
    if(!res.ok) throw new Error('Failed to load config');
    config = await res.json();
    console.log('Loaded config', config);
  }catch(e){
    console.warn('Could not load config/variables-config.json — using empty config. Error:', e);
    config = {};
  }
}

function setStatus(text){
  status.textContent = text;
}

function updatePreview(){
  jsonPreview.value = JSON.stringify(variables, null, 2);
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

function makeControl(key, value, desc){
  // desc example:
  // { type: "boolean" | "string" | "number" | "number_array",
  //   input: "toggle" | "slider" | "text" | "manual",
  //   readonly: false,
  //   min: 0, max: 10, step: 1,
  //   count: 3, // for arrays
  //   label: "Pretty name"
  // }
  const row = document.createElement('div');
  row.className = 'control-row';
  const label = document.createElement('label');
  label.innerHTML = `<span class="key">${key}</span><div class="help">${desc && desc.label ? desc.label : ''}</div>`;
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
  const keys = Object.keys(vars);
  if(keys.length === 0){
    controlsEl.textContent = 'No variables found in the loaded file.';
    return;
  }
  keys.forEach(key => {
    const desc = config[key];
    const control = makeControl(key, vars[key], desc || {});
    controlsEl.appendChild(control);
  });

  // Show a note for any variables present in config but missing from file
  const missing = Object.keys(config).filter(k => !keys.includes(k));
  if(missing.length){
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<strong>Note</strong><div class="help">Config has ${missing.length} variable(s) not found in uploaded file: <code>${missing.join(', ')}</code>. You can add them in the raw JSON.</div>`;
    controlsEl.appendChild(card);
  }
}

function applyVariables(obj){
  variables = structuredClone(obj);
  original = structuredClone(obj);
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
    applyVariables(obj);
  }catch(e){
    alert('Invalid JSON file.');
  }
});

loadExample.addEventListener('click', async () => {
  try{
    const res = await fetch('/examples/_global_variables.example.json');
    if(!res.ok) throw new Error('No example file');
    const obj = await res.json();
    applyVariables(obj);
  }catch(e){
    alert('Could not load example from /examples/_global_variables.example.json — you can still paste raw JSON.');
  }
});

applyRaw.addEventListener('click', () => {
  try{
    const parsed = JSON.parse(rawEditor.value);
    applyVariables(parsed);
  }catch(e){
    alert('Invalid JSON in raw editor.');
  }
});

jsonPreview.addEventListener('input', () => {
  // keep it readonly for preview; but if user edits preview, try to parse and apply
  try{
    const parsed = JSON.parse(jsonPreview.value);
    variables = parsed;
    renderControlsForVariables(variables);
    rawEditor.value = JSON.stringify(variables, null, 2);
  }catch(e){
    // ignore parse errors while typing
  }
});

downloadBtn.addEventListener('click', downloadJSON);

resetBtn.addEventListener('click', () => {
  if(!original) return;
  applyVariables(original);
});

async function init(){
  await loadConfig();
  setStatus('Ready. Load a _global_variables.json to begin.');
  // If user visits page without uploading: try to fetch example silently
  try{
    const r = await fetch('/examples/_global_variables.example.json');
    if(r.ok) {
      // no-op; just make example available
    }
  }catch(e){}
}

init();
