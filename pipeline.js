(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TripoPipeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
    const MODEL_INFO = {
        'v3.1-20260211': {
            name: 'H3.1', tier: 'standard', credits: 30, topology: 'triangle',
            faceMin: 1, faceMax: 1500000, textureVersion: 'v3.5-20260815', delight: true, quad: false
        },
        'P2-20260801': {
            name: 'P2', tier: 'premium', credits: 110, topology: 'dual',
            faceMin: 48, faceMax: 50000, quadFaceMax: 25000, textureVersion: 'v3.5-20260815', delight: true, quad: true
        },
        'P1-20260311': {
            name: 'P1', tier: 'premium', credits: 110, topology: 'triangle',
            faceMin: 50, faceMax: 20000, textureVersion: 'v3.5-20260815', delight: true, quad: false
        },
        'v3.0-20250812': {
            name: 'H3.0', tier: 'standard', credits: 30, topology: 'triangle',
            faceMin: 1, faceMax: 1000000, textureVersion: 'v3.5-20260815', delight: true, quad: false
        },
        'v2.5-20250123': {
            name: 'H2.5', tier: 'standard', credits: 30, topology: 'triangle',
            faceMin: 1, faceMax: 500000, textureVersion: 'legacy', delight: false, quad: false
        }
    };
    const MODEL_COST = Object.fromEntries(Object.entries(MODEL_INFO).map(([k, v]) => [k, v.credits]));
    const FACE_RANGES = Object.fromEntries(Object.entries(MODEL_INFO).map(([k, v]) => [k, [v.faceMin, v.faceMax]]));
    const FORMATS = ['fbx', 'gltf', 'obj', 'stl'];
    const VIEWS = ['front', 'left', 'back', 'right'];

    function faceRange(model, quad = false) {
        if (model === 'P2-20260801' && quad) return [48, 25000];
        return FACE_RANGES[model] || [1, 1000000];
    }

    function estimateCredits({ inputType, model, quad, autoRig }) {
        if (!(model in MODEL_COST)) throw new Error('Unsupported model version');
        const image = inputType === 'side' ? 5 : 0;
        const multiview = ['side', 'tpose'].includes(inputType) ? 10 : 0;
        const conversion = quad ? 10 : 5;
        const rig = autoRig ? 30 : 0;
        return { image, multiview, model: MODEL_COST[model], conversion, rig,
            total: image + multiview + MODEL_COST[model] + conversion + rig };
    }

    function validateImage(file, label) {
        if (!file) throw new Error(`${label} image is required`);
        if (!['image/jpeg', 'image/png'].includes(file.type)) {
            throw new Error(`${label} must be a JPEG or PNG image`);
        }
        if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
            throw new Error(`${label} must be non-empty and at most 20 MB`);
        }
    }

    function validateSettings(settings, files) {
        if (!['object', 'side', 'tpose', 'multiview'].includes(settings.inputType)) throw new Error('Unknown input mode');
        if (!(settings.model in MODEL_COST)) throw new Error('Unsupported model version');
        if (!FORMATS.includes(settings.format)) throw new Error('Unsupported output format');
        if (settings.quad && settings.format !== 'fbx') throw new Error('Quad topology requires FBX output');
        if (settings.quad && settings.model === 'P1-20260311') throw new Error('P1 does not support quad topology; choose P2 or disable quad');
        if (settings.bake && settings.format === 'stl') throw new Error('STL cannot contain baked textures');
        if (settings.autoRig && !['fbx', 'gltf'].includes(settings.format)) throw new Error('Auto-rigging requires FBX or GLTF output');
        if (settings.faceLimit !== '') {
            const faceLimit = Number(settings.faceLimit);
            const [min, max] = faceRange(settings.model, settings.quad);
            if (!Number.isSafeInteger(faceLimit) || faceLimit < min || faceLimit > max) {
                throw new Error(`Face limit for ${settings.model}${settings.quad ? ' (quad)' : ''} must be ${min}–${max}, or left blank`);
            }
        }
        if (settings.inputType === 'multiview') {
            validateImage(files.front, 'Front');
            if (!VIEWS.slice(1).some(view => files[view])) {
                throw new Error('Provide at least one more view (left, back, or right)');
            }
            for (const view of VIEWS.slice(1)) if (files[view]) validateImage(files[view], view);
        } else {
            validateImage(files.single, 'Source');
        }
    }

    function imageToModelPayload(input, settings) {
        const payload = {
            input, model: settings.model, texture: true, pbr: true,
            texture_quality: 'standard'
        };
        if (settings.model !== 'v2.5-20250123') {
            payload.texture_version = 'v3.5-20260815';
            payload.delight = true;
        }
        if (settings.model === 'P2-20260801' && settings.quad) {
            payload.quad = true;
        }
        if (settings.faceLimit !== '') payload.face_limit = Number(settings.faceLimit);
        return payload;
    }

    function modelPayload(inputs, settings) {
        const payload = {
            inputs, model: settings.model, texture: true, pbr: true,
            texture_quality: 'standard'
        };
        if (settings.model !== 'v2.5-20250123') {
            payload.texture_version = 'v3.5-20260815';
            payload.delight = true;
        }
        if (settings.model === 'P2-20260801' && settings.quad) {
            payload.quad = true;
        }
        if (settings.faceLimit !== '') payload.face_limit = Number(settings.faceLimit);
        return payload;
    }

    function viewInputs(tokens) {
        return VIEWS.filter(view => tokens[view]).map(view => ({ [view]: tokens[view] }));
    }

    function convertPayload(taskId, settings) {
        const payload = { input: taskId, format: settings.format.toUpperCase(), bake: settings.bake };
        if (settings.quad) {
            payload.quad = true;
            if (settings.faceLimit !== '') payload.face_limit = Number(settings.faceLimit);
        }
        if (settings.format === 'fbx') payload.fbx_preset = 'mixamo';
        return payload;
    }

    function allowedResultUrl(raw) {
        if (typeof raw !== 'string' || raw.length > 16384) return null;
        try {
            const parsed = new URL(raw);
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
            if (parsed.hostname !== 'cdn.tripo3d.ai' && !parsed.hostname.endsWith('.cdn.tripo3d.ai') &&
                parsed.hostname !== 'tripo-data.rg1.data.tripo3d.com') return null;
            return parsed;
        } catch { return null; }
    }

    function resultUrl(output, field) {
        const url = output && (output[field] || output.generate_multiview_image?.[field]);
        if (typeof url !== 'string') throw new Error(`Task result has no ${field}`);
        const parsed = allowedResultUrl(url);
        if (!parsed) throw new Error(`Task result ${field} is not a supported Tripo file URL`);
        return parsed.href;
    }

    return { MAX_IMAGE_BYTES, MODEL_INFO, MODEL_COST, FACE_RANGES, FORMATS, VIEWS, faceRange,
        estimateCredits, validateImage, validateSettings, imageToModelPayload, modelPayload,
        viewInputs, convertPayload, resultUrl, allowedResultUrl };
});
