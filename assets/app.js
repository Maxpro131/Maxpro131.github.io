// Editor (safe mode): no file upload, no raw edits.
// - Loads config from config/variables-config.json
// - Loads example from examples/_global_variables.example.json (resolved relative to page URL)
// - Uses only keys present in config.variables (unknown keys ignored)
// - Readonly behavior controlled by config.variables[$key].readonly
// - Supports "choice" input type and persist last user state across reloads (sessionStorage)
// - Pretty-prints JSON but keeps simple arrays on one line: [0, 1, -0.5]

const CONFIG_URL = new URL('config/variables-config.json', location.href).href;
const EXAMPLE_URL = new URL('examples/_global_variables.example.json', location.href).href;

const STORAGE_KEY_USER = 'deesse_lastUser';
const STORAGE_KEY_DEFAULTS = 'deesse_defaults';

const controlsEl = document.getElementById('controls');
const jsonPreview = document.getElementById('jsonPreview');
const downloadBtn = document.getElementById('downloadBtn');
const loadExampleBtn = document.getElementById('loadExample');
const resetBtn = document.getElementById('resetBtn');
const status = document.getElementById('status');
const pageTitle = document.getElementById('pageTitle');
const searchInput = document.getElementById('searchInput');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebarNav = document.getElementById('sidebarNav');
const menuBtn = document.getElementById('menuBtn');
const closeSidebarBtn = document.getElementById('closeSidebar');
const previewModal = document.getElementById('previewModal');
const previewImage = document.getElementById('previewImage');
const previewTitle = document.getElementById('previewTitle');
const closePreviewBtn = document.getElementById('closePreview');

let currentSearchTerm = '';

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

function saveUserState(){
  try {
    sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(variables));
  } catch(e){
    // ignore storage errors (private mode etc.)
    console.warn('Could not save user state', e);
  }
}

function loadUserState(){
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_USER);
    if(!raw) return null;
    return JSON.parse(raw);
  } catch(e){
    console.warn('Could not read user state', e);
    return null;
  }
}

function saveDefaultsToStorage(){
  try {
    sessionStorage.setItem(STORAGE_KEY_DEFAULTS, JSON.stringify(defaults));
  } catch(e){
    console.warn('Could not save defaults', e);
  }
}

function updateModifiedStatus(key, value, rowEl) {
  const isModified = JSON.stringify(value) !== JSON.stringify(defaults[key]);
  if (isModified) {
    rowEl.classList.add('modified');
  } else {
    rowEl.classList.remove('modified');
  }
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
      updateModifiedStatus(key, variables[key], row);
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
        updateModifiedStatus(key, variables[key], row);
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
        updateModifiedStatus(key, variables[key], row);
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
      updateModifiedStatus(key, variables[key], row);
    });
    number.addEventListener('input', () => {
      if (number.value === '') return;
      range.value = number.value;
      variables[key] = Number(number.value);
      updatePreview();
      updateModifiedStatus(key, variables[key], row);
    });
    number.addEventListener('blur', () => {
      if (number.value === '') {
        const resetVal = defaultFor(desc);
        variables[key] = resetVal;
        number.value = resetVal;
        range.value = resetVal;
        updatePreview();
        updateModifiedStatus(key, variables[key], row);
      }
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
        if (num.value === '') return;
        const idx = Number(num.dataset.index);
        if(!Array.isArray(variables[key])) variables[key] = Array(count).fill(0);
        variables[key][idx] = Number(num.value);
        updatePreview();
        updateModifiedStatus(key, variables[key], row);
      });
      num.addEventListener('blur', () => {
        if (num.value === '') {
          const idx = Number(num.dataset.index);
          const defArr = defaultFor(desc);
          const resetVal = defArr[idx];
          variables[key][idx] = resetVal;
          num.value = resetVal;
          updatePreview();
          updateModifiedStatus(key, variables[key], row);
        }
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
      if (isNumber && input.value === '') return;
      let val;
      if(isNumber) val = Number(input.value);
      else val = input.value;
      variables[key] = val;
      updatePreview();
      updateModifiedStatus(key, variables[key], row);
    });
    if (isNumber) {
      input.addEventListener('blur', () => {
        if (input.value === '') {
          const resetVal = defaultFor(desc);
          variables[key] = resetVal;
          input.value = resetVal;
          updatePreview();
          updateModifiedStatus(key, variables[key], row);
        }
      });
    }
    right.appendChild(input);
  }

  if(readonly){
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'readonly';
    right.appendChild(badge);
  }

  if(desc && desc.previewURL) {
    const previewBtn = document.createElement('button');
    previewBtn.className = 'preview-btn';
    previewBtn.title = 'Show Preview';
    previewBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </svg>
    `;
    previewBtn.addEventListener('click', () => {
      previewTitle.textContent = desc.label || key;
      previewImage.src = desc.previewURL;
      previewModal.classList.add('visible');
    });
    right.appendChild(previewBtn);
  }

  // Initial modified status
  updateModifiedStatus(key, value, row);

  row.appendChild(right);
  return row;
}

function matchesSearch(key, desc, searchTerm){
  if(!searchTerm) return true;
  if(desc && desc.type === 'section') return false;
  const term = searchTerm.toLowerCase();
  const keyMatch = key.toLowerCase().includes(term);
  const labelMatch = desc && desc.label && desc.label.toLowerCase().includes(term);
  const helpMatch = desc && desc.help && desc.help.toLowerCase().includes(term);
  return keyMatch || labelMatch || helpMatch;
}

function makeSection(desc){
  const section = document.createElement('div');
  section.className = 'section-header';
  const title = document.createElement('h3');
  title.textContent = desc.label || 'Section';
  section.appendChild(title);
  if(desc.help){
    const helpText = document.createElement('p');
    helpText.className = 'section-help';
    helpText.textContent = desc.help;
    section.appendChild(helpText);
  }
  return section;
}

function renderControlsForVariables(){
  controlsEl.innerHTML = '';
  sidebarNav.innerHTML = '';
  const vars = config.variables || {};
  const keys = Object.keys(vars);
  if(keys.length === 0){
    controlsEl.textContent = 'No variables configured. Add entries to config/variables-config.json';
    return;
  }
  let visibleCount = 0;
  keys.forEach(k => {
    const desc = vars[k] || {};
    if(desc.type === 'section'){
      if(!currentSearchTerm){
        const sectionId = `section-${k}`;
        const sectionEl = makeSection(desc);
        sectionEl.id = sectionId;
        controlsEl.appendChild(sectionEl);

        // Add to sidebar
        const navItem = document.createElement('a');
        navItem.className = 'nav-item';
        navItem.textContent = desc.label || 'Section';
        navItem.addEventListener('click', (e) => {
          e.preventDefault();
          const target = document.getElementById(sectionId);
          if (target) {
            const topBarHeight = document.querySelector('.top-bar').offsetHeight;
            const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - topBarHeight - 20;
            window.scrollTo({
              top: targetPosition,
              behavior: 'smooth'
            });
            toggleSidebar(false);
          }
        });
        sidebarNav.appendChild(navItem);
      }
      return;
    }
    if(!matchesSearch(k, desc, currentSearchTerm)) return;
    const val = variables[k] !== undefined ? variables[k] : defaultFor(desc);
    controlsEl.appendChild(makeControl(k, val, desc));
    visibleCount++;
  });
  if(visibleCount === 0 && currentSearchTerm){
    controlsEl.textContent = 'No variables match your search.';
  }
}

function toggleSidebar(open) {
  if (open) {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
  } else {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
    document.body.style.overflow = '';
  }
}

menuBtn.addEventListener('click', () => toggleSidebar(true));
closeSidebarBtn.addEventListener('click', () => toggleSidebar(false));
sidebarOverlay.addEventListener('click', () => toggleSidebar(false));

closePreviewBtn.addEventListener('click', () => {
  previewModal.classList.remove('visible');
  previewImage.src = '';
});

previewModal.addEventListener('click', (e) => {
  if (e.target === previewModal) {
    previewModal.classList.remove('visible');
    previewImage.src = '';
  }
});

// Scroll to top functionality
const scrollToTopBtn = document.getElementById('scrollToTop');
window.addEventListener('scroll', () => {
  if (window.scrollY > 300) {
    scrollToTopBtn.classList.add('visible');
  } else {
    scrollToTopBtn.classList.remove('visible');
  }
});

scrollToTopBtn.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
});

// Always return an object with keys from config.variables using source if present,
// otherwise falling back to desc.default or a sensible default.
function buildSanitizedFromSource(source){
  const out = {};
  const vars = config.variables || {};
  Object.keys(vars).forEach(k => {
    const desc = vars[k];
    if(desc && desc.type === 'section') return;
    if(source && Object.prototype.hasOwnProperty.call(source, k)) {
      out[k] = source[k];
    } else {
      out[k] = defaultFor(vars[k]);
    }
  });
  return out;
}

async function loadExampleAndApply(){
  try {
    const r = await fetch(EXAMPLE_URL);
    if(!r.ok) throw new Error('No example file');
    const src = await r.json();
    variables = buildSanitizedFromSource(src);
    defaults = buildSanitizedFromSource(src);
    // Save defaults to sessionStorage so they can be inspected if needed
    saveDefaultsToStorage();
    updatePreview();
    renderControlsForVariables();
    status.textContent = 'Example loaded (sanitized to configured keys).';
  } catch(e) {
    // Fall back to config defaults
    variables = buildSanitizedFromSource(null);
    defaults = buildSanitizedFromSource(null);
    saveDefaultsToStorage();
    updatePreview();
    renderControlsForVariables();
    status.textContent = 'Example loaded.';
    console.warn('Example load failed', e);
  }
}

function resetToDefaults(){
  // If the user previously changed values we saved them to sessionStorage,
  // prefer restoring that "last user state" so reset behaves like "restore last used".
  const saved = loadUserState();
  if(saved){
    variables = structuredClone(saved);
    status.textContent = 'Restored last used state (from this tab).';
  } else {
    variables = structuredClone(defaults);
    status.textContent = 'Reset to defaults.';
  }
  updatePreview();
  renderControlsForVariables();
}

// Pretty print JSON but keep simple arrays of primitives on a single line.
// - Uses JSON.stringify(obj, null, 2) then collapses arrays that don't contain objects/arrays.
// This keeps arrays like [0, 1, -0.5] inline while preserving readable indentation elsewhere.
function prettyPrintJSON(obj){
  let s = JSON.stringify(obj, null, 2);
  // Collapse arrays consisting only of primitives (no nested objects/arrays).
  // Pattern: [\n   <primitive>,\n   <primitive>\n  ]
  s = s.replace(/\[\n(\s*)([^\[\]\{\}]*?)\n\s*\]/gs, (m, indent, inner) => {
    // inner contains lines like "0,", "1,", "-0.5," or strings with quotes.
    // Convert interior newlines + indentation to single spaces, and normalize commas/spaces.
    const oneLine = inner
      .replace(/\n\s*/g, ' ')     // join lines with spaces
      .replace(/,\s*/g, ', ')     // ensure a space after commas
      .trim();
    if(oneLine === '') return '[]';
    return '[' + oneLine + ']';
  });
  return s;
}

function updatePreview(){
  jsonPreview.value = prettyPrintJSON(variables);
  // Save user state to sessionStorage after any change so it survives reload
  saveUserState();
}

function downloadJSON(){
  const content = prettyPrintJSON(variables) + '\n';
  const blob = new Blob([content], {type:'application/json'});
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
searchInput.addEventListener('input', () => {
  currentSearchTerm = searchInput.value.trim();
  renderControlsForVariables();
});

async function init(){
  await loadConfig();

  // Clean up any section keys from old session storage
  function cleanSectionKeys(obj){
    if(!obj) return obj;
    const vars = config.variables || {};
    Object.keys(obj).forEach(k => {
      if(vars[k] && vars[k].type === 'section') delete obj[k];
    });
    return obj;
  }

  // If there's a saved last-user state in sessionStorage, restore it as the starting variables.
  // Otherwise load the example (and save defaults).
  let saved = loadUserState();
  saved = cleanSectionKeys(saved);
  if(saved){
    // Also load defaults from storage if present (so reset still works against a stored default)
    try {
      const d = sessionStorage.getItem(STORAGE_KEY_DEFAULTS);
      if(d) defaults = JSON.parse(d);
    } catch(e){}
    variables = structuredClone(saved);
    // Ensure UI uses sanitized shape: keep only keys from config
    variables = buildSanitizedFromSource(variables);
    // If defaults are empty, fetch example (non-blocking) to populate them
    if(!Object.keys(defaults).length) {
      await loadExampleAndApply();
    } else {
      updatePreview();
      renderControlsForVariables();
      status.textContent = 'Restored last used state.';
    }
  } else {
    await loadExampleAndApply();
  }

  status.textContent = 'Ready.';
}

// Add JSZip via CDN for simplicity in static site
const jszipScript = document.createElement('script');
jszipScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
document.head.appendChild(jszipScript);

const configurePackBtn = document.getElementById('configurePackBtn');
const packModal = document.getElementById('packModal');
const cancelPackBtn = document.getElementById('cancelPackBtn');
const uploadPackBtn = document.getElementById('uploadPackBtn');
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const packStatus = document.getElementById('packStatus');

let selectedPackFile = null;

configurePackBtn.addEventListener('click', () => {
  packModal.classList.add('visible');
  resetPackModal();
});

cancelPackBtn.addEventListener('click', () => {
  packModal.classList.remove('visible');
});

function resetPackModal() {
  selectedPackFile = null;
  uploadPackBtn.disabled = true;
  packStatus.textContent = 'No file selected.';
  packStatus.style.color = '#666';
}

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) {
    handleFileSelect(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) {
    handleFileSelect(e.target.files[0]);
  }
});

function handleFileSelect(file) {
  // Relaxed extension check to help with mobile/iOS issues
  const ext = file.name.split('.').pop().toLowerCase();
  // On iOS, .mcpack might be reported as application/octet-stream or have no clear extension in some contexts
  // We'll allow any file if the user picks it, but hint at .mcpack
  selectedPackFile = file;
  packStatus.textContent = `Selected: ${file.name}`;
  packStatus.style.color = '#00c853';
  uploadPackBtn.disabled = false;
}

uploadPackBtn.addEventListener('click', async () => {
  if (!selectedPackFile) return;

  uploadPackBtn.disabled = true;
  packStatus.textContent = 'Processing pack...';
  packStatus.style.color = 'var(--accent)';

  try {
    const zip = new JSZip();
    const contents = await selectedPackFile.arrayBuffer();
    const loadedZip = await zip.loadAsync(contents);

    // Find the main folder containing the ui/ directory
    // Pattern: <MainFolder>/ui/_global_variables.json
    let targetPath = null;
    const files = Object.keys(loadedZip.files);

    // Look for a path ending in ui/_global_variables.json
    for (const path of files) {
      if (path.endsWith('ui/_global_variables.json')) {
        targetPath = path;
        break;
      }
    }

    if (!targetPath) {
      // Fallback: try to find any 'ui/' directory and create the file if it doesn't exist
      for (const path of files) {
        if (path.includes('/ui/') || path.startsWith('ui/')) {
          const parts = path.split('/ui/');
          targetPath = parts[0] + (parts[0] ? '/' : '') + 'ui/_global_variables.json';
          break;
        }
      }
    }

    if (!targetPath) {
      throw new Error('Could not find ui/ directory in pack.');
    }

    const updatedJSON = prettyPrintJSON(variables) + '\n';
    loadedZip.file(targetPath, updatedJSON);

    const blob = await loadedZip.generateAsync({ type: 'blob', mimeType: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // Fixed name to avoid duplicates
    a.download = `PatchedDéesseUI.mcpack`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    packStatus.textContent = 'Pack patched successfully!';
    packStatus.style.color = '#00c853';
    setTimeout(() => {
      packModal.classList.remove('visible');
    }, 1500);

  } catch (e) {
    console.error(e);
    packStatus.textContent = `Error: ${e.message}`;
    packStatus.style.color = '#ff1744';
    uploadPackBtn.disabled = false;
  }
});

init();
