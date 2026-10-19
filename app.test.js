const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('./pipeline');
const I = require('./i18n');

class Element {
    constructor() {
        this.children = [];
        this.listeners = {};
        this.hidden = false;
        this.disabled = false;
        this.checked = false;
        this.open = false;
        this.value = '';
        this.files = [];
        this.dataset = {};
    }
    get textContent() { return this._text ?? this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = [...children]; }
    remove() {}
    click() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    querySelectorAll() { return this.controls || []; }
}

function browser(mode) {
    const ids = ['apiKey', 'pipelineCard', 'apiKeyCard', 'runBtn', 'logs', 'applyKeyBtn',
        'changeKeyBtn', 'inputType', 'paramModelVersion', 'paramFaceLimit', 'paramFormat',
        'paramBake', 'paramQuad', 'paramRig', 'singleInput', 'viewInputs', 'faceHint', 'costEstimate',
        'imageFile', 'frontFile', 'leftFile', 'backFile', 'rightFile', 'intermediateResults',
        'intermediateSection', 'resultContainer', 'pipelineStatus', 'connectionStatus', 'keyError',
        'sourcePreview', 'sourceFileInfo', 'creditTotal', 'validationError', 'inputDescription', 'keyStateDot',
        'modelInfoBtn', 'modelModal', 'closeModalBtn', 'closeModalFooterBtn', 'modelSummaryHint'];
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    elements.inputType.value = mode;
    elements.paramModelVersion.value = 'v3.1-20260211';
    elements.paramFaceLimit.value = '8000';
    elements.paramFormat.value = 'fbx';
    elements.paramBake.checked = true;
    elements.pipelineCard.controls = ids.filter(id => id.endsWith('File') || id === 'imageFile' || id.startsWith('param') || id === 'inputType').map(id => elements[id]);
    const picture = new File(['png'], 'character.png', { type: 'image/png' });
    if (mode === 'multiview') {
        elements.frontFile.files = [picture];
        elements.backFile.files = [picture];
    } else elements.imageFile.files = [picture];
    const calls = [];
    let uploads = 0;
    let connected = true;
    let lastSessionBody;
    const tasks = {
        pose: { task_id: 'pose', status: 'success', output: { generated_image_url: 'https://cdn.tripo3d.ai/pose.png' }, credits_consumed: 5 },
        views: { task_id: 'views', status: 'success', output: Object.fromEntries(P.VIEWS.map(view => [`${view}_view_url`, `https://cdn.tripo3d.ai/${view}.png`])) },
        model: { task_id: 'model', status: 'success', output: { model_url: 'https://cdn.tripo3d.ai/model.glb' } },
        check: { task_id: 'check', status: 'success', output: { riggable: true, rig_type: 'biped' } },
        rig: { task_id: 'rig', status: 'success', output: { model_url: 'https://cdn.tripo3d.ai/model_rigged.fbx' }, credits_consumed: 30 },
        converted: { task_id: 'converted', status: 'success', output: { model_url: 'https://cdn.tripo3d.ai/model.fbx' } }
    };
    const json = data => new Response(JSON.stringify({ code: 0, data }), { headers: { 'Content-Type': 'application/json' } });
    async function fetchMock(url, options = {}) {
        if (url === '/api/session') {
            if (options.method === 'POST') { lastSessionBody = JSON.parse(options.body); connected = true; }
            if (options.method === 'DELETE') connected = false;
            return json({ connected });
        }
        if (url.startsWith('/api/download?')) return new Response(new Blob(['model data']));
        if (url.startsWith('/api/v3/tasks/')) return json(tasks[url.split('/').pop()]);
        if (url === '/api/v3/files') return json({ file_token: `file_${++uploads}` });
        assert.equal(options.headers['X-Tripo-Key'], undefined);
        assert.equal(options.headers.Authorization, undefined);
        calls.push({ url, payload: JSON.parse(options.body) });
        if (url.endsWith('image-to-image')) return json({ task_id: 'pose' });
        if (url.endsWith('image-to-multiview')) return json({ task_id: 'views' });
        if (url.endsWith('image-to-model')) return json({ task_id: 'model' });
        if (url.endsWith('multiview-to-model')) return json({ task_id: 'model' });
        if (url.endsWith('rig-check')) return json({ task_id: 'check' });
        if (url.endsWith('animations/rig')) return json({ task_id: 'rig' });
        if (url.endsWith('models/convert')) return json({ task_id: 'converted' });
        throw new Error(`Unexpected URL: ${url}`);
    }
    const storage = new Map([['tripo_api_key', 'test-key']]);
    const persistent = new Map([['tripo_api_key', 'old-persistent-key']]);
    const fakeURL = class extends URL {};
    fakeURL.createObjectURL = () => 'blob:mock';
    fakeURL.revokeObjectURL = () => {};
    const context = {
        TripoPipeline: P, TripoI18n: I, document: {
            documentElement: { lang: 'en' },
            addEventListener: () => {},
            getElementById: id => elements[id],
            createElement: () => new Element(),
            createTextNode: text => text,
            body: new Element()
        },
        localStorage: { removeItem: key => persistent.delete(key) },
        sessionStorage: {
            getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        },
        fetch: fetchMock, FormData, AbortSignal, URL: fakeURL, Response, Blob,
        Date, setTimeout: () => 1, encodeURIComponent, console,
        alert: message => { throw new Error(`Unexpected alert: ${message}`); }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('./app.js'), 'utf8'), context);
    return { elements, calls, storage, persistent, sessionBody: () => lastSessionBody, ready: vm.runInNewContext('sessionReady', context), uploads: () => uploads };
}

for (const mode of ['side', 'tpose', 'multiview']) {
    test(`browser pipeline sends documented V3 payloads in ${mode} mode`, async () => {
        const { elements, calls, uploads } = browser(mode);
        await elements.runBtn.listeners.click();
        assert.equal(elements.runBtn.disabled, false);
        assert.equal(elements.resultContainer.hidden, false);
        assert.equal(calls.at(-1).url, '/api/v3/models/convert');
        assert.equal(calls.at(-1).payload.input, 'model');
        assert.equal(calls.at(-1).payload.format, 'FBX');
        assert.equal(calls.find(call => call.url.endsWith('rig-check')).payload.input, 'model');
        const modelCall = calls.find(call => call.url.endsWith('multiview-to-model'));
        assert.ok(modelCall);
        assert.equal(modelCall.payload.model, 'v3.1-20260211');
        assert.equal('files' in modelCall.payload, false);
        assert.equal('original_task_id' in modelCall.payload, false);
        if (mode === 'multiview') {
            assert.equal(uploads(), 2);
            assert.equal(JSON.stringify(modelCall.payload.inputs), JSON.stringify([{ front: 'file_1' }, { back: 'file_2' }]));
            assert.equal(elements.intermediateSection.hidden, true);
        } else {
            assert.equal(uploads(), 1);
            assert.equal(JSON.stringify(modelCall.payload.inputs), JSON.stringify([{ task_id: 'views' }]));
            assert.equal(elements.intermediateSection.hidden, false);
            assert.equal(elements.intermediateResults.children.length, mode === 'side' ? 5 : 4);
            const multiviewCall = calls.find(call => call.url.endsWith('image-to-multiview'));
            assert.equal(multiviewCall.payload.input, mode === 'side' ? 'https://cdn.tripo3d.ai/pose.png' : 'file_1');
        }
        assert.equal(elements.logs.children.some(row => row.textContent.includes('Pipeline stopped')), false);
    });
}

test('changing output format clears and disables incompatible quad and rig settings', () => {
    const { elements } = browser('tpose');
    elements.paramQuad.checked = true;
    elements.paramRig.checked = true;
    elements.paramFormat.value = 'obj';
    elements.paramFormat.listeners.change();
    assert.equal(elements.paramQuad.checked, false);
    assert.equal(elements.paramQuad.disabled, true);
    assert.equal(elements.paramRig.checked, false);
    assert.equal(elements.paramRig.disabled, true);
    assert.match(elements.creditTotal.textContent, /45 credits/);

    elements.paramBake.checked = true;
    elements.paramFormat.value = 'stl';
    elements.paramFormat.listeners.change();
    assert.equal(elements.paramBake.checked, false);
    assert.equal(elements.paramBake.disabled, true);

    // GLTF supports auto-rigging but not quad
    elements.paramFormat.value = 'gltf';
    elements.paramFormat.listeners.change();
    assert.equal(elements.paramRig.disabled, false);
    assert.equal(elements.paramQuad.disabled, true);

    // P1 model prohibits quad even when format is FBX
    elements.paramFormat.value = 'fbx';
    elements.paramModelVersion.value = 'P1-20260311';
    elements.paramModelVersion.listeners.change();
    assert.equal(elements.paramQuad.disabled, true);
});

test('browser pipeline triggers Rig v3.0 when autoRig is enabled', async () => {
    const { elements, calls } = browser('tpose');
    elements.paramRig.checked = true;
    elements.paramFormat.value = 'fbx';
    elements.paramFormat.listeners.change();
    assert.match(elements.creditTotal.textContent, /75 credits/);
    await elements.runBtn.listeners.click();
    const rigCall = calls.find(call => call.url.endsWith('animations/rig'));
    assert.ok(rigCall, 'animations/rig was called');
    assert.equal(rigCall.payload.model, 'v3.0-20260909');
    assert.equal(rigCall.payload.spec, 'mixamo');
    assert.equal(rigCall.payload.out_format, 'fbx');
    assert.equal(rigCall.payload.input, 'model');
    assert.equal(elements.logs.children.some(row => row.textContent.includes('Rig v3.0')), true);
});

test('STL skips rig check and sends bake false', async () => {
    const { elements, calls } = browser('multiview');
    elements.paramFormat.value = 'stl';
    elements.paramFormat.listeners.change();
    await elements.runBtn.listeners.click();
    assert.equal(calls.some(call => call.url.endsWith('rig-check')), false);
    assert.equal(calls.some(call => call.url.endsWith('animations/rig')), false);
    assert.equal(calls.at(-1).payload.bake, false);
    assert.equal(calls.at(-1).payload.format, 'STL');
    assert.equal(calls.at(-1).payload.quad, undefined);
});

test('an out-of-range face limit blocks submission until corrected', () => {
    const { elements } = browser('tpose');
    elements.paramModelVersion.value = 'P1-20260311';
    elements.paramFaceLimit.value = '20001';
    elements.paramModelVersion.listeners.change();
    assert.equal(elements.runBtn.disabled, true);
    assert.match(elements.faceHint.textContent, /Invalid/);
    elements.paramFaceLimit.value = '20000';
    elements.paramFaceLimit.listeners.input();
    assert.equal(elements.runBtn.disabled, false);
});


test('API key goes only to the session endpoint and browser storage is cleared', async () => {
    const { elements, storage, persistent, ready, sessionBody } = browser('tpose');
    await ready;
    assert.equal(persistent.has('tripo_api_key'), false);
    assert.equal(storage.has('tripo_api_key'), false);
    assert.equal(elements.apiKey.value, '');
    await elements.changeKeyBtn.listeners.click();
    assert.equal(elements.pipelineCard.hidden, true);
    assert.equal(elements.connectionStatus.className, 'connection-pill disconnected');
    elements.apiKey.value = 'new-server-key';
    await elements.applyKeyBtn.listeners.click();
    assert.equal(sessionBody().apiKey, 'new-server-key');
    assert.equal(storage.has('tripo_api_key'), false);
    assert.equal(elements.apiKey.value, '');
    assert.equal(elements.pipelineCard.hidden, false);
    assert.equal(elements.connectionStatus.className, 'connection-pill connected');
});

test('browser pipeline sends documented V3 payloads in object mode without rig check', async () => {
    const { elements, calls, uploads } = browser('object');
    assert.equal(elements.inputDescription.textContent, I.translate('en', 'singleObjectHint'));
    assert.equal(elements.singleInput.hidden, false);
    assert.equal(elements.viewInputs.hidden, true);
    assert.match(elements.modelSummaryHint.textContent, /H3\.1/);
    await elements.runBtn.listeners.click();
    assert.equal(elements.runBtn.disabled, false);
    assert.equal(elements.resultContainer.hidden, false);
    assert.equal(uploads(), 1);
    const imageToModelCall = calls.find(call => call.url.endsWith('image-to-model'));
    assert.ok(imageToModelCall, 'image-to-model was called');
    assert.equal(imageToModelCall.payload.input, 'file_1');
    assert.equal(imageToModelCall.payload.model, 'v3.1-20260211');
    assert.equal(calls.some(call => call.url.endsWith('rig-check')), false, 'object mode skips rig check');
    assert.equal(calls.some(call => call.url.endsWith('image-to-multiview')), false);
    assert.equal(calls.at(-1).url, '/api/v3/models/convert');
    assert.equal(calls.at(-1).payload.input, 'model');
});

test('model guide modal opens and closes and modelSummaryHint reacts to model change', () => {
    const { elements } = browser('object');
    assert.match(elements.modelSummaryHint.textContent, /H3\.1/);
    elements.paramModelVersion.value = 'P2-20260801';
    elements.paramModelVersion.listeners.change();
    assert.match(elements.modelSummaryHint.textContent, /P2/);
    elements.paramModelVersion.value = 'P1-20260311';
    elements.paramModelVersion.listeners.change();
    assert.match(elements.modelSummaryHint.textContent, /P1/);

    elements.modelInfoBtn.listeners.click();
    assert.equal(elements.modelModal.open, true);
    elements.closeModalBtn.listeners.click();
    assert.equal(elements.modelModal.open, false);
    elements.modelInfoBtn.listeners.click();
    assert.equal(elements.modelModal.open, true);
    elements.closeModalFooterBtn.listeners.click();
    assert.equal(elements.modelModal.open, false);
});

