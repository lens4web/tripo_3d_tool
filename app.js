'use strict';

const P = TripoPipeline;
const I = TripoI18n;
const t = (key, values) => I.translate(document.documentElement.lang, key, values);
const errorText = error => I.localizeError(document.documentElement.lang, error.message);
const el = id => document.getElementById(id);
const apiKeyInput = el('apiKey');
const pipelineCard = el('pipelineCard');
const apiKeyCard = el('apiKeyCard');
const runBtn = el('runBtn');
const logBox = el('logs');
// Remove legacy keys once. New keys never go into browser storage.
try { localStorage.removeItem('tripo_api_key'); } catch {}
try { sessionStorage.removeItem('tripo_api_key'); } catch {}
let sessionApplied = false;
let running = false;
apiKeyInput.value = '';

function translatedNode(node, key, values = {}) {
    node.dataset.i18n = key;
    node.dataset.i18nValues = JSON.stringify(values);
    const resolved = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value && typeof value === 'object' && value.key ? t(value.key) : value]));
    node.textContent = t(key, resolved);
}
function setStatus(key, kind = '') {
    translatedNode(el('pipelineStatus'), key);
    el('pipelineStatus').className = `status-pill ${kind}`;
}
function showKeyState() {
    apiKeyCard.hidden = sessionApplied;
    pipelineCard.hidden = !sessionApplied;
    translatedNode(el('connectionStatus'), sessionApplied ? 'keyApplied' : 'keyNotApplied');
    el('connectionStatus').className = `connection-pill ${sessionApplied ? 'connected' : 'disconnected'}`;
    el('keyStateDot').className = `api-state-dot${sessionApplied ? ' connected' : ''}`;
}
showKeyState();
async function sessionRequest(method, body) {
    const response = await fetch('/api/session', {
        method, credentials: 'same-origin', signal: AbortSignal.timeout(15000),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    return readApiResponse(response);
}
const sessionReady = sessionRequest('GET').then(response => {
    sessionApplied = response.data.connected === true;
    showKeyState();
}).catch(() => { sessionApplied = false; showKeyState(); });
el('applyKeyBtn').addEventListener('click', async () => {
    await sessionReady;
    const value = apiKeyInput.value.trim();
    if (!value) {
        el('keyError').hidden = false;
        translatedNode(el('keyError'), 'enterKey');
        return;
    }
    el('applyKeyBtn').disabled = true;
    apiKeyInput.value = '';
    try {
        await sessionRequest('POST', { apiKey: value });
        sessionApplied = true;
        el('keyError').hidden = true;
        showKeyState();
    } catch (error) {
        el('keyError').hidden = false;
        translatedNode(el('keyError'), 'keyFailure', { error: errorText(error) });
    } finally { el('applyKeyBtn').disabled = false; }
});
el('changeKeyBtn').addEventListener('click', async () => {
    el('changeKeyBtn').disabled = true;
    try {
        await sessionRequest('DELETE');
        sessionApplied = false;
        showKeyState();
    } catch (error) { log('disconnectFailure', { error: errorText(error) }, 'error'); }
    finally { el('changeKeyBtn').disabled = false; }
});
apiKeyInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') el('applyKeyBtn').click();
});

const modelModal = el('modelModal');
const modelInfoBtn = el('modelInfoBtn');
const closeModalBtn = el('closeModalBtn');
const closeModalFooterBtn = el('closeModalFooterBtn');
if (modelInfoBtn && modelModal) {
    modelInfoBtn.addEventListener('click', () => {
        if (typeof modelModal.showModal === 'function') modelModal.showModal();
        else modelModal.hidden = false;
    });
}
const closeModal = () => {
    if (modelModal) {
        if (typeof modelModal.close === 'function') modelModal.close();
        else modelModal.hidden = true;
    }
};
if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
if (closeModalFooterBtn) closeModalFooterBtn.addEventListener('click', closeModal);
if (modelModal) {
    modelModal.addEventListener('click', event => {
        if (event.target === modelModal) closeModal();
    });
}

let previewUrl;
let customTripoParams = {};
el('imageFile').addEventListener('change', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = el('imageFile').files[0];
    el('sourcePreview').hidden = true;
    el('sourceFileInfo').textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : t('noImage');
    if (file && ['image/png', 'image/jpeg'].includes(file.type) && file.size <= P.MAX_IMAGE_BYTES) {
        previewUrl = URL.createObjectURL(file);
        el('sourcePreview').src = previewUrl;
        el('sourcePreview').hidden = false;
    }
});

function settings() {
    return {
        inputType: el('inputType').value,
        model: el('paramModelVersion').value,
        faceLimit: el('paramFaceLimit').value.trim(),
        format: el('paramFormat').value,
        bake: el('paramBake').checked,
        textureSize: el('paramTextureSize') ? Number(el('paramTextureSize').value) : 2048,
        textureQuality: el('paramTextureQuality') ? el('paramTextureQuality').value : 'standard',
        geometryQuality: el('paramGeometryQuality') ? el('paramGeometryQuality').value : 'standard',
        quad: el('paramQuad').checked,
        forceSymmetry: el('paramForceSymmetry') ? el('paramForceSymmetry').checked : false,
        delight: el('paramDelight') ? el('paramDelight').checked : true,
        enableImageAutofix: el('paramAutofix') ? el('paramAutofix').checked : false,
        smartLowPoly: el('paramSmartLowPoly') ? el('paramSmartLowPoly').checked : false,
        generateParts: el('paramGenerateParts') ? el('paramGenerateParts').checked : false,
        segment: el('paramSegment') ? el('paramSegment').checked : false,
        autoRig: el('paramRig') ? el('paramRig').checked : false,
        rigSpec: el('paramRigSpec') ? el('paramRigSpec').value : 'mixamo',
        customParams: customTripoParams
    };
}
function syncOptions() {
    el('validationError').hidden = true;
    const inputMode = el('inputType').value;
    const isMultiview = inputMode === 'multiview';
    const isObject = inputMode === 'object';
    const descKey = isObject ? 'singleObjectHint' : (isMultiview ? 'separateImages' : 'simpleBackground');
    el('inputDescription').textContent = t(descKey);
    el('singleInput').hidden = isMultiview;
    el('viewInputs').hidden = !isMultiview;
    const modelHints = {
        'v3.1-20260211': 'modelHintH31',
        'P2-20260801': 'modelHintP2',
        'P1-20260311': 'modelHintP1',
        'v3.0-20250812': 'modelHintH30',
        'v2.5-20250123': 'modelHintH25'
    };
    const model = el('paramModelVersion').value;
    const hintKey = modelHints[model];
    const modelHintNode = el('modelSummaryHint');
    if (modelHintNode && hintKey) {
        translatedNode(modelHintNode, hintKey);
    }
    const quad = el('paramQuad');
    const isP1 = model === 'P1-20260311';
    const isH25 = model === 'v2.5-20250123';
    const canQuad = el('paramFormat').value === 'fbx' && !isP1 && !isH25;
    if (!canQuad) quad.checked = false;
    quad.disabled = !canQuad;
    const forceSymmetry = el('paramForceSymmetry');
    if (forceSymmetry) {
        if (!quad.checked) forceSymmetry.checked = false;
        forceSymmetry.disabled = !quad.checked;
    }
    const geomQuality = el('paramGeometryQuality');
    const geomQualityField = el('geometryQualityField');
    const supportsGeomQuality = ['v3.1-20260211', 'v3.0-20250812'].includes(model);
    if (geomQuality) {
        geomQuality.disabled = !supportsGeomQuality;
        if (!supportsGeomQuality) geomQuality.value = 'standard';
    }
    if (geomQualityField) geomQualityField.hidden = !supportsGeomQuality;
    const bake = el('paramBake');
    if (el('paramFormat').value === 'stl') bake.checked = false;
    bake.disabled = el('paramFormat').value === 'stl';
    const textureSize = el('paramTextureSize');
    if (textureSize) {
        textureSize.disabled = !bake.checked || el('paramFormat').value === 'stl';
    }
    const rig = el('paramRig');
    const rigOption = el('rigOption');
    const rigNote = el('rigNote');
    const rigSpecField = el('rigSpecField');
    if (rig) {
        const canRig = ['fbx', 'gltf'].includes(el('paramFormat').value) && !isObject;
        if (!canRig) rig.checked = false;
        rig.disabled = !canRig;
    }
    if (rigOption) rigOption.hidden = isObject;
    if (rigNote) rigNote.hidden = isObject;
    if (rigSpecField) rigSpecField.hidden = !rig?.checked || isObject;

    const smartLowPoly = el('paramSmartLowPoly')?.checked;
    const generateParts = el('paramGenerateParts');
    if (generateParts) {
        if (generateParts.checked && (quad.checked || smartLowPoly)) {
            generateParts.checked = false;
        }
        generateParts.disabled = quad.checked || smartLowPoly;
    }

    const [min, max] = P.faceRange(model, quad.checked, geomQuality?.value, smartLowPoly);
    el('paramFaceLimit').min = min;
    el('paramFaceLimit').max = max;
    const rawFaces = el('paramFaceLimit').value.trim();
    const faces = Number(rawFaces);
    const invalidFaces = rawFaces !== '' && (!Number.isSafeInteger(faces) || faces < min || faces > max);
    el('faceHint').textContent = `${invalidFaces ? t('invalid') + ' ' : ''}${t('allowedFaces', { min: min.toLocaleString(document.documentElement.lang), max: max.toLocaleString(document.documentElement.lang) })}`;
    el('faceHint').className = invalidFaces ? 'error' : 'muted';
    runBtn.disabled = invalidFaces || running;
    const cost = P.estimateCredits(settings());
    el('creditTotal').textContent = t('credits', { count: cost.total });
    el('costEstimate').textContent = t('costBreakdown', {
        usd: (cost.total * 0.01).toFixed(2),
        image: cost.image,
        views: cost.multiview,
        model: cost.model,
        texture: cost.texture,
        segment: cost.segmentation,
        export: cost.conversion,
        rig: cost.rig
    });
}
['inputType', 'paramModelVersion', 'paramFormat', 'paramQuad', 'paramForceSymmetry', 'paramRig', 'paramRigSpec', 'paramBake', 'paramDelight', 'paramAutofix', 'paramSmartLowPoly', 'paramGenerateParts', 'paramTextureQuality', 'paramTextureSize', 'paramGeometryQuality', 'paramSegment'].forEach(id => {
    const node = el(id);
    if (node) node.addEventListener('change', syncOptions);
});
el('paramFaceLimit').addEventListener('input', syncOptions);

const jsonModal = el('jsonModal');
const jsonConfigBtn = el('jsonConfigBtn');
const closeJsonModalBtn = el('closeJsonModalBtn');
const applyJsonBtn = el('applyJsonBtn');
const copyJsonBtn = el('copyJsonBtn');
const jsonConfigText = el('jsonConfigText');
const jsonError = el('jsonError');
const jsonSuccess = el('jsonSuccess');

if (jsonConfigBtn && jsonModal) {
    jsonConfigBtn.addEventListener('click', () => {
        if (jsonError) jsonError.hidden = true;
        if (jsonSuccess) jsonSuccess.hidden = true;
        if (jsonConfigText) jsonConfigText.value = P.exportJsonConfig(settings());
        if (typeof jsonModal.showModal === 'function') jsonModal.showModal();
        else jsonModal.hidden = false;
    });
}
const closeJsonModal = () => {
    if (jsonModal) {
        if (typeof jsonModal.close === 'function') jsonModal.close();
        else jsonModal.hidden = true;
    }
};
if (closeJsonModalBtn) closeJsonModalBtn.addEventListener('click', closeJsonModal);
if (jsonModal) {
    jsonModal.addEventListener('click', event => {
        if (event.target === jsonModal) closeJsonModal();
    });
}
if (copyJsonBtn) {
    copyJsonBtn.addEventListener('click', async () => {
        const text = jsonConfigText ? jsonConfigText.value : P.exportJsonConfig(settings());
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            if (jsonConfigText) {
                jsonConfigText.select();
                try { document.execCommand('copy'); } catch {}
            }
        }
        if (jsonSuccess) {
            jsonSuccess.textContent = t('jsonCopied');
            jsonSuccess.hidden = false;
        }
    });
}
if (applyJsonBtn) {
    applyJsonBtn.addEventListener('click', () => {
        if (jsonError) jsonError.hidden = true;
        if (jsonSuccess) jsonSuccess.hidden = true;
        try {
            const raw = jsonConfigText.value.trim();
            if (!raw) throw new Error('JSON is empty');
            const cfg = P.parseJsonConfig(raw);
            if (cfg.inputType && el('inputType')) el('inputType').value = cfg.inputType;
            if (cfg.model && el('paramModelVersion')) el('paramModelVersion').value = cfg.model;
            if (cfg.format && el('paramFormat')) el('paramFormat').value = cfg.format.toLowerCase();
            if (cfg.faceLimit !== undefined && el('paramFaceLimit')) el('paramFaceLimit').value = cfg.faceLimit === null ? '' : String(cfg.faceLimit);
            if (cfg.bake !== undefined && el('paramBake')) el('paramBake').checked = !!cfg.bake;
            if (cfg.textureSize && el('paramTextureSize')) el('paramTextureSize').value = String(cfg.textureSize);
            if (cfg.textureQuality && el('paramTextureQuality')) el('paramTextureQuality').value = cfg.textureQuality;
            if (cfg.geometryQuality && el('paramGeometryQuality')) el('paramGeometryQuality').value = cfg.geometryQuality;
            if (cfg.quad !== undefined && el('paramQuad')) el('paramQuad').checked = !!cfg.quad;
            if (cfg.forceSymmetry !== undefined && el('paramForceSymmetry')) el('paramForceSymmetry').checked = !!cfg.forceSymmetry;
            if (cfg.delight !== undefined && el('paramDelight')) el('paramDelight').checked = !!cfg.delight;
            if (cfg.enableImageAutofix !== undefined && el('paramAutofix')) el('paramAutofix').checked = !!cfg.enableImageAutofix;
            if (cfg.smartLowPoly !== undefined && el('paramSmartLowPoly')) el('paramSmartLowPoly').checked = !!cfg.smartLowPoly;
            if (cfg.generateParts !== undefined && el('paramGenerateParts')) el('paramGenerateParts').checked = !!cfg.generateParts;
            if (cfg.segment !== undefined && el('paramSegment')) el('paramSegment').checked = !!cfg.segment;
            if (cfg.autoRig !== undefined && el('paramRig')) el('paramRig').checked = !!cfg.autoRig;
            if (cfg.rigSpec && el('paramRigSpec')) el('paramRigSpec').value = cfg.rigSpec;
            customTripoParams = cfg.customParams || {};
            syncOptions();
            if (jsonSuccess) {
                jsonSuccess.textContent = t('jsonApplied');
                jsonSuccess.hidden = false;
            }
            setTimeout(closeJsonModal, 800);
        } catch (err) {
            if (jsonError) {
                jsonError.textContent = err.message;
                jsonError.hidden = false;
            }
        }
    });
}
syncOptions();

function log(key, values = {}, kind = '') {
    const row = document.createElement('div');
    row.className = kind;
    const time = new Date().toLocaleTimeString(document.documentElement.lang);
    const content = document.createElement('span');
    translatedNode(content, key, values);
    row.append(document.createTextNode(`[${time}] `), content);
    logBox.appendChild(row);
    logBox.scrollTop = logBox.scrollHeight;
}
function taskId(response) {
    const id = response?.data?.task_id;
    if (typeof id !== 'string' || !id) throw new Error('API response has no task_id');
    return id;
}
async function readApiResponse(response) {
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); }
    catch { throw new Error(`Non-JSON API response (${response.status})`); }
    if (!response.ok || data.code !== 0) {
        if (response.status === 401) { sessionApplied = false; showKeyState(); }
        throw new Error(t('apiFailure', { status: response.status, error: I.localizeError(document.documentElement.lang, data.message || data.error_message || 'Request failed') }));
    }
    return data;
}
async function postApi(path, payload) {
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(payload), signal: AbortSignal.timeout(60000)
    });
    return readApiResponse(response);
}
async function uploadImage(file) {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/v3/files', {
        method: 'POST', credentials: 'same-origin',
        body: form, signal: AbortSignal.timeout(120000)
    });
    const data = await readApiResponse(response);
    if (typeof data?.data?.file_token !== 'string') throw new Error('Upload returned no file_token');
    return data.data.file_token;
}
async function pollTask(id) {
    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
        const response = await fetch(`/api/v3/tasks/${encodeURIComponent(id)}`, {
            credentials: 'same-origin', signal: AbortSignal.timeout(30000)
        });
        const task = (await readApiResponse(response)).data;
        if (!task || typeof task.status !== 'string') throw new Error('Task response has no status');
        if (task.status === 'success') return { ...task, task_id: task.task_id || id };
        if (task.status === 'failed' || task.status === 'cancelled') {
            throw new Error(`Task ${id} ${task.status}: ${task.error_message || task.error_code || 'No details'}`);
        }
        if (!['queued', 'running'].includes(task.status)) throw new Error(`Unknown task status: ${task.status}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    throw new Error(`Task ${id} did not finish within 20 minutes`);
}
function downloadLink(url, filename, label, values = {}) {
    const link = document.createElement('a');
    link.href = `/api/download?url=${encodeURIComponent(url)}`;
    link.download = filename;
    translatedNode(link, label, values);
    return link;
}
function sourceLink(url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    translatedNode(link, 'originalFile');
    return link;
}
async function autoDownload(url, filename) {
    try {
        const response = await fetch(`/api/download?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(180000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.size) throw new Error('Empty download');
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    } catch (error) {
        log('downloadFailed', { file: filename, error: errorText(error) }, 'error');
    }
}
function showImage(titleKey, url, filename, values = {}) {
    const card = document.createElement('div');
    card.className = 'preview';
    const heading = document.createElement('strong');
    translatedNode(heading, titleKey, values);
    const image = document.createElement('img');
    image.src = `/api/download?url=${encodeURIComponent(url)}`;
    image.alt = heading.textContent;
    card.append(heading, image, downloadLink(url, filename, 'downloadImage'), sourceLink(url));
    el('intermediateResults').appendChild(card);
    el('intermediateSection').hidden = false;
    autoDownload(url, filename);
}
function showModel(url, filename, label, values = {}) {
    const container = el('resultContainer');
    if (container.hidden) {
        const heading = document.createElement('h2');
        translatedNode(heading, 'files3d');
        container.appendChild(heading);
    }
    const row = document.createElement('p');
    row.append(downloadLink(url, filename, label, values), document.createTextNode(' · '), sourceLink(url));
    container.appendChild(row);
    container.hidden = false;
    autoDownload(url, filename);
}
function logCredits(task, label) {
    if (typeof task.credits_consumed === 'number') log('actualCredits', { step: { key: label }, count: task.credits_consumed }, 'success');
}
runBtn.addEventListener('click', async () => {
    await sessionReady;
    if (running || !sessionApplied) return;
    el('validationError').hidden = true;
    const selected = settings();
    const files = {
        single: el('imageFile').files[0], front: el('frontFile').files[0],
        left: el('leftFile').files[0], back: el('backFile').files[0], right: el('rightFile').files[0]
    };
    try { P.validateSettings(selected, files); }
    catch (error) {
        el('validationError').textContent = errorText(error);
        el('validationError').hidden = false;
        return;
    }
    running = true;
    setStatus('running', 'running');
    translatedNode(runBtn, 'generatingButton');
    runBtn.disabled = true;
    el('changeKeyBtn').disabled = true;
    pipelineCard.querySelectorAll('input, select').forEach(control => control.disabled = true);
    logBox.replaceChildren();
    el('intermediateResults').replaceChildren();
    el('intermediateSection').hidden = true;
    el('resultContainer').replaceChildren();
    el('resultContainer').hidden = true;
    try {
        let modelTaskId;
        if (selected.inputType === 'object') {
            log('uploadSource');
            const fileToken = await uploadImage(files.single);
            log('createModel', { model: selected.model });
            const modelId = taskId(await postApi('/api/v3/generation/image-to-model', P.imageToModelPayload(fileToken, selected)));
            const modelTask = await pollTask(modelId);
            modelTaskId = modelTask.task_id;
            const rawUrl = P.resultUrl(modelTask.output, 'model_url');
            showModel(rawUrl, 'step1_raw_model.glb', 'downloadRaw');
            logCredits(modelTask, 'model3d');
        } else {
            let inputs;
            if (selected.inputType === 'multiview') {
                const tokens = {};
                for (const view of P.VIEWS) {
                    if (files[view]) {
                        log('uploadView', { view: { key: view } });
                        tokens[view] = await uploadImage(files[view]);
                    }
                }
                inputs = P.viewInputs(tokens);
            } else {
                log('uploadSource');
                let imageInput = await uploadImage(files.single);
                if (selected.inputType === 'side') {
                    log('createPose');
                    const id = taskId(await postApi('/api/v3/generation/image-to-image', {
                        input: imageInput, template: 't_pose', model: 'seedream_v5'
                    }));
                    const task = await pollTask(id);
                    imageInput = P.resultUrl(task.output, 'generated_image_url');
                    showImage('T-pose', imageInput, 'step1_tpose.png');
                    logCredits(task, 'T-pose');
                }
                log('createViews');
                const mvId = taskId(await postApi('/api/v3/generation/image-to-multiview', { input: imageInput }));
                const mvTask = await pollTask(mvId);
                for (const view of P.VIEWS) {
                    const url = P.resultUrl(mvTask.output, `${view}_view_url`);
                    showImage('viewTitle', url, `step2_${view}.png`, { view: { key: view } });
                }
                logCredits(mvTask, 'multiview');
                inputs = [{ task_id: mvTask.task_id }];
            }
            log('createModel', { model: selected.model });
            const modelId = taskId(await postApi('/api/v3/generation/multiview-to-model', P.modelPayload(inputs, selected)));
            const modelTask = await pollTask(modelId);
            modelTaskId = modelTask.task_id;
            const rawUrl = P.resultUrl(modelTask.output, 'model_url');
            showModel(rawUrl, 'step3_raw_model.glb', 'downloadRaw');
            logCredits(modelTask, 'model3d');
        }

        if (selected.segment) {
            log('segmenting');
            const segId = taskId(await postApi('/api/v3/mesh/segment', P.segmentPayload(modelTaskId)));
            const segTask = await pollTask(segId);
            modelTaskId = segTask.task_id;
            const segUrl = P.resultUrl(segTask.output, 'model_url');
            showModel(segUrl, 'segmented_model.glb', 'downloadSegmented');
            logCredits(segTask, 'segmentStep');
            log('segmentComplete', {}, 'success');
        }

        if ((selected.autoRig || selected.format === 'fbx') && selected.inputType !== 'object') {
            try {
                log('rigCheck');
                const checkId = taskId(await postApi('/api/v3/animations/rig-check', { input: modelTaskId }));
                const check = await pollTask(checkId);
                if (check.output?.riggable === true && check.output?.rig_type === 'biped') {
                    log('rigSuccess', {}, 'success');
                } else {
                    log('rigUnconfirmed', { type: check.output?.rig_type || t('unknown') }, 'error');
                }
            } catch (error) {
                log('rigUnavailable', { error: errorText(error) }, 'error');
            }
        }

        if (selected.autoRig && selected.inputType !== 'object') {
            log('rigging');
            const rigFormat = selected.format === 'fbx' ? 'fbx' : 'glb';
            const rigId = taskId(await postApi('/api/v3/animations/rig', {
                model: 'v3.0-20260909',
                spec: selected.rigSpec || 'mixamo',
                input: modelTaskId,
                out_format: rigFormat
            }));
            const rigged = await pollTask(rigId);
            const riggedUrl = P.resultUrl(rigged.output, 'model_url');
            showModel(riggedUrl, `rigged_model.${rigFormat}`, 'downloadRigged', { format: rigFormat.toUpperCase() });
            logCredits(rigged, 'rigStep');
            log('rigComplete', {}, 'success');
        }

        log('converting', { format: selected.format.toUpperCase() });
        const convertId = taskId(await postApi('/api/v3/models/convert', P.convertPayload(modelTaskId, selected)));
        const converted = await pollTask(convertId);
        const finalUrl = P.resultUrl(converted.output, 'model_url');
        showModel(finalUrl, `final_model.${selected.format}`, 'downloadModel', { format: selected.format.toUpperCase() });
        logCredits(converted, 'conversion');
        log('pipelineComplete', {}, 'success');
        setStatus('complete', 'complete');
    } catch (error) {
        log('pipelineStopped', { error: errorText(error) }, 'error');
        setStatus('stopped', 'failed');
    } finally {
        running = false;
        pipelineCard.querySelectorAll('input, select').forEach(control => control.disabled = false);
        el('changeKeyBtn').disabled = false;
        runBtn.disabled = false;
        translatedNode(runBtn, 'generate');
        syncOptions();
    }
});


document.addEventListener('tripo-language-change', () => {
    showKeyState();
    syncOptions();
    if (!el('imageFile').files[0]) el('sourceFileInfo').textContent = t('noImage');
});
