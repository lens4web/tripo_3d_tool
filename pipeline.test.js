const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./pipeline');

const image = { type: 'image/png', size: 1024 };
const base = { inputType: 'side', model: 'v3.1-20260211', format: 'fbx', faceLimit: '8000', bake: true, quad: false };

test('all four input modes validate the files they actually need', () => {
    assert.doesNotThrow(() => P.validateSettings({ ...base, inputType: 'object' }, { single: image }));
    assert.doesNotThrow(() => P.validateSettings(base, { single: image }));
    assert.doesNotThrow(() => P.validateSettings({ ...base, inputType: 'tpose' }, { single: image }));
    assert.doesNotThrow(() => P.validateSettings({ ...base, inputType: 'multiview' }, { front: image, back: image }));
    assert.throws(() => P.validateSettings({ ...base, inputType: 'multiview' }, { front: image }), /at least one more view/);
    assert.throws(() => P.validateSettings({ ...base, inputType: 'multiview' }, { back: image }), /Front image/);
    assert.throws(() => P.validateSettings(base, { single: { type: 'image/webp', size: 1024 } }), /JPEG or PNG/);
    assert.throws(() => P.validateSettings(base, { single: { type: 'image/png', size: P.MAX_IMAGE_BYTES + 1 } }), /20 MB/);
});

test('model ranges and incompatible format combinations are rejected', () => {
    assert.throws(() => P.validateSettings({ ...base, model: 'P1-20260311', faceLimit: '49' }, { single: image }), /50/);
    assert.throws(() => P.validateSettings({ ...base, model: 'P2-20260801', faceLimit: '50001' }, { single: image }), /50000/);
    assert.throws(() => P.validateSettings({ ...base, faceLimit: '8000.5' }, { single: image }), /Face limit/);
    assert.throws(() => P.validateSettings({ ...base, format: 'obj', quad: true }, { single: image }), /requires FBX/);
    assert.throws(() => P.validateSettings({ ...base, format: 'stl', bake: true }, { single: image }), /cannot contain baked textures/);
    assert.throws(() => P.validateSettings({ ...base, forceSymmetry: true, quad: false }, { single: image }), /Force symmetry/);
    assert.throws(() => P.validateSettings({ ...base, textureQuality: 'super' }, { single: image }), /Unsupported texture quality/);
    assert.throws(() => P.validateSettings({ ...base, textureSize: '123' }, { single: image }), /Unsupported texture size/);
    assert.doesNotThrow(() => P.validateSettings({ ...base, quad: true, forceSymmetry: true, textureQuality: 'detailed', textureSize: '2048' }, { single: image }));
    assert.doesNotThrow(() => P.validateSettings({ ...base, faceLimit: '' }, { single: image }));
});

test('V3 payloads use inputs for model and input for conversion and image-to-model', () => {
    assert.deepEqual(P.viewInputs({ front: 'front-token', back: 'back-token' }), [
        { front: 'front-token' }, { back: 'back-token' }
    ]);
    assert.deepEqual(P.imageToModelPayload('obj-token', base), {
        input: 'obj-token', model: base.model, texture: true,
        pbr: true, texture_quality: 'standard', texture_version: 'v3.5-20260815',
        delight: true, face_limit: 8000
    });
    assert.deepEqual(P.imageToModelPayload('obj-token', { ...base, textureQuality: 'detailed' }), {
        input: 'obj-token', model: base.model, texture: true,
        pbr: true, texture_quality: 'detailed', texture_version: 'v3.5-20260815',
        delight: true, face_limit: 8000
    });
    assert.deepEqual(P.imageToModelPayload('obj-token', { ...base, model: 'P2-20260801', quad: true }), {
        input: 'obj-token', model: 'P2-20260801', texture: true,
        pbr: true, texture_quality: 'standard', texture_version: 'v3.5-20260815',
        delight: true, quad: true, face_limit: 8000
    });
    assert.deepEqual(P.imageToModelPayload('obj-token', { ...base, model: 'v2.5-20250123' }), {
        input: 'obj-token', model: 'v2.5-20250123', texture: true,
        pbr: true, texture_quality: 'standard', face_limit: 8000
    });
    assert.deepEqual(P.modelPayload([{ task_id: 'mv-task' }], base), {
        inputs: [{ task_id: 'mv-task' }], model: base.model, texture: true,
        pbr: true, texture_quality: 'standard', texture_version: 'v3.5-20260815',
        delight: true, face_limit: 8000
    });
    assert.deepEqual(P.modelPayload([{ task_id: 'mv-task' }], { ...base, model: 'P2-20260801', quad: true }), {
        inputs: [{ task_id: 'mv-task' }], model: 'P2-20260801', texture: true,
        pbr: true, texture_quality: 'standard', texture_version: 'v3.5-20260815',
        delight: true, quad: true, face_limit: 8000
    });
    assert.deepEqual(P.modelPayload([{ task_id: 'mv-task' }], { ...base, model: 'v2.5-20250123' }), {
        inputs: [{ task_id: 'mv-task' }], model: 'v2.5-20250123', texture: true,
        pbr: true, texture_quality: 'standard', face_limit: 8000
    });
    assert.deepEqual(P.convertPayload('model-task', { ...base, quad: true, bake: false }), {
        input: 'model-task', format: 'FBX', bake: false, quad: true, face_limit: 8000, fbx_preset: 'mixamo'
    });
    assert.deepEqual(P.convertPayload('model-task', { ...base, quad: true, forceSymmetry: true, bake: true, textureSize: 2048 }), {
        input: 'model-task', format: 'FBX', bake: true, texture_size: 2048, quad: true, force_symmetry: true, face_limit: 8000, fbx_preset: 'mixamo'
    });
    assert.deepEqual(P.convertPayload('model-task', { ...base, format: 'stl', bake: false }), {
        input: 'model-task', format: 'STL', bake: false
    });
    assert.deepEqual(P.segmentPayload('model-task'), {
        input: 'model-task'
    });
});

test('task URLs and cost estimates use current V3 fields and published tiers', () => {
    assert.equal(P.resultUrl({ model_url: 'https://cdn.tripo3d.ai/model.glb' }, 'model_url'), 'https://cdn.tripo3d.ai/model.glb');
    assert.throws(() => P.resultUrl({ model: { url: 'https://cdn.tripo3d.ai/model.glb' } }, 'model_url'), /no model_url/);
    assert.equal(P.estimateCredits(base).total, 50);
    assert.equal(P.estimateCredits({ ...base, inputType: 'object' }).total, 35);
    assert.equal(P.estimateCredits({ ...base, inputType: 'object', autoRig: true }).total, 35);
    assert.equal(P.estimateCredits({ ...base, textureQuality: 'detailed' }).total, 60);
    assert.equal(P.estimateCredits({ ...base, segment: true }).total, 90);
    assert.equal(P.estimateCredits({ ...base, model: 'P1-20260311' }).total, 70);
    assert.equal(P.estimateCredits({ ...base, model: 'P2-20260801', inputType: 'multiview', quad: true }).total, 120);
    assert.equal(P.estimateCredits({ ...base, autoRig: true }).total, 75);
    assert.equal(P.MODEL_INFO['P2-20260801'].quad, true);
    assert.equal(P.MODEL_INFO['P1-20260311'].quad, false);
    assert.equal(P.MODEL_INFO['v3.1-20260211'].quad, true);
});

test('JSON configuration parses snake_case and camelCase and exports cleanly', () => {
    const jsonStr = JSON.stringify({
        model: 'v3.1-20260211',
        geometry_quality: 'detailed',
        texture_quality: 'detailed',
        face_limit: 1500000,
        quad: true,
        delight: true,
        enable_image_autofix: true,
        custom_seed: 42
    });
    const parsed = P.parseJsonConfig(jsonStr);
    assert.equal(parsed.model, 'v3.1-20260211');
    assert.equal(parsed.geometryQuality, 'detailed');
    assert.equal(parsed.textureQuality, 'detailed');
    assert.equal(parsed.faceLimit, 1500000);
    assert.equal(parsed.quad, true);
    assert.equal(parsed.delight, true);
    assert.equal(parsed.enableImageAutofix, true);
    assert.deepEqual(parsed.customParams, { custom_seed: 42 });

    const exported = JSON.parse(P.exportJsonConfig(parsed));
    assert.equal(exported.model, 'v3.1-20260211');
    assert.equal(exported.geometryQuality, 'detailed');
    assert.equal(exported.custom_seed, 42);
});

test('P2 quad face ranges and rigging validations follow documented constraints', () => {
    assert.deepEqual(P.faceRange('P2-20260801', false), [48, 50000]);
    assert.deepEqual(P.faceRange('P2-20260801', true), [48, 25000]);
    assert.throws(() => P.validateSettings({ ...base, model: 'P1-20260311', quad: true }, { single: image }), /P1 does not support quad topology/);
    assert.throws(() => P.validateSettings({ ...base, format: 'obj', autoRig: true }, { single: image }), /Auto-rigging requires FBX or GLTF/);
    assert.throws(() => P.validateSettings({ ...base, model: 'P2-20260801', quad: true, faceLimit: '25001' }, { single: image }), /25000/);
    assert.doesNotThrow(() => P.validateSettings({ ...base, model: 'P2-20260801', quad: true, faceLimit: '25000' }, { single: image }));
});

test('multiview links support nested results and only approved Tripo hosts', () => {
    const url = 'https://tripo-data.rg1.data.tripo3d.com/view.jpeg?Signature=abc';
    assert.equal(P.resultUrl({ generate_multiview_image: { front_view_url: url } }, 'front_view_url'), url);
    assert.throws(() => P.resultUrl({ model_url: 'javascript:alert(1)' }, 'model_url'), /supported Tripo/);
    assert.throws(() => P.resultUrl({ model_url: 'https://evil.test/file.glb' }, 'model_url'), /supported Tripo/);
});

