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
            faceMin: 1, faceMax: 1500000, quadFaceMax: 150000, detailedFaceMax: 2000000,
            textureVersion: 'v3.5-20260815', delight: true, quad: true
        },
        'P2-20260801': {
            name: 'P2', tier: 'premium', credits: 110, topology: 'dual',
            faceMin: 48, faceMax: 50000, quadFaceMax: 25000,
            textureVersion: 'v3.5-20260815', delight: true, quad: true
        },
        'P1-20260311': {
            name: 'P1', tier: 'premium', credits: 50, topology: 'triangle',
            faceMin: 50, faceMax: 20000,
            textureVersion: 'v3.5-20260815', delight: true, quad: false
        },
        'v3.0-20250812': {
            name: 'H3.0', tier: 'standard', credits: 30, topology: 'triangle',
            faceMin: 1, faceMax: 1000000, quadFaceMax: 150000, detailedFaceMax: 2000000,
            textureVersion: 'v3.5-20260815', delight: true, quad: true
        },
        'v2.5-20250123': {
            name: 'H2.5', tier: 'standard', credits: 30, topology: 'triangle',
            faceMin: 1, faceMax: 500000,
            textureVersion: 'legacy', delight: false, quad: false
        }
    };
    const MODEL_COST = Object.fromEntries(Object.entries(MODEL_INFO).map(([k, v]) => [k, v.credits]));
    const FACE_RANGES = Object.fromEntries(Object.entries(MODEL_INFO).map(([k, v]) => [k, [v.faceMin, v.faceMax]]));
    const FORMATS = ['fbx', 'gltf', 'obj', 'stl'];
    const VIEWS = ['front', 'left', 'back', 'right'];
    const TEXTURE_QUALITIES = ['fast', 'standard', 'detailed', 'extreme'];
    const GEOMETRY_QUALITIES = ['standard', 'detailed'];
    const RIG_SPECS = ['mixamo', 'tripo', 'actorcore', 'unity', 'unreal', 'vrm'];

    function faceRange(model, quad = false, geometryQuality = 'standard', smartLowPoly = false) {
        if (smartLowPoly) {
            return quad ? [500, 10000] : [500, 20000];
        }
        if (model === 'P2-20260801') {
            return quad ? [48, 25000] : [48, 50000];
        }
        if (model === 'P1-20260311') {
            return [50, 20000];
        }
        if (model === 'v3.1-20260211') {
            if (quad) return [1, 150000];
            return [1, geometryQuality === 'detailed' ? 2000000 : 1500000];
        }
        if (model === 'v3.0-20250812') {
            if (quad) return [1, 150000];
            return [1, geometryQuality === 'detailed' ? 2000000 : 1000000];
        }
        if (model === 'v2.5-20250123') {
            return [1, 500000];
        }
        return FACE_RANGES[model] || [1, 1000000];
    }

    function estimateCredits({
        inputType, model, quad, autoRig, textureQuality = 'standard',
        segment = false, geometryQuality = 'standard', smartLowPoly = false, generateParts = false
    }) {
        if (!(model in MODEL_COST)) throw new Error('Unsupported model version');
        const image = inputType === 'side' ? 5 : 0;
        const multiview = ['side', 'tpose'].includes(inputType) ? 10 : 0;
        const texture = textureQuality === 'detailed' ? 10 : (textureQuality === 'extreme' ? 20 : 0);
        const geometry = (geometryQuality === 'detailed' && ['v3.1-20260211', 'v3.0-20250812'].includes(model)) ? 20 : 0;
        const smartLowPolyAddon = smartLowPoly ? 10 : 0;
        const partsAddon = generateParts ? 20 : 0;
        const segmentation = segment ? 40 : 0;
        const conversion = quad ? 10 : 5;
        const rig = (autoRig && inputType !== 'object') ? 25 : 0;
        const baseModel = MODEL_COST[model];
        return {
            image, multiview, model: baseModel, texture, geometry,
            smartLowPolyAddon, partsAddon,
            segmentation, conversion, rig,
            total: image + multiview + baseModel + texture + geometry +
                smartLowPolyAddon + partsAddon + segmentation + conversion + rig
        };
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
        if (settings.quad && settings.model === 'v2.5-20250123') throw new Error('H2.5 does not support quad topology');
        if (settings.forceSymmetry && !settings.quad) throw new Error('Force symmetry requires quad topology');
        if (settings.bake && settings.format === 'stl') throw new Error('STL cannot contain baked textures');
        if (settings.autoRig && !['fbx', 'gltf'].includes(settings.format)) throw new Error('Auto-rigging requires FBX or GLTF output');
        if (settings.rigSpec && !RIG_SPECS.includes(settings.rigSpec)) throw new Error('Unsupported rig spec');
        if (settings.textureQuality && !TEXTURE_QUALITIES.includes(settings.textureQuality)) throw new Error('Unsupported texture quality');
        if (settings.geometryQuality && !GEOMETRY_QUALITIES.includes(settings.geometryQuality)) throw new Error('Unsupported geometry quality');
        if (settings.textureSize && ![1024, 2048, 4096].includes(Number(settings.textureSize))) throw new Error('Unsupported texture size');
        if (settings.faceLimit !== '') {
            const faceLimit = Number(settings.faceLimit);
            const [min, max] = faceRange(settings.model, settings.quad, settings.geometryQuality, settings.smartLowPoly);
            if (!Number.isSafeInteger(faceLimit) || faceLimit < min || faceLimit > max) {
                throw new Error(`Face limit for ${settings.model}${settings.quad ? ' (quad)' : ''} must be ${min}–${max}, or left blank`);
            }
        }
        if (settings.generateParts) {
            if (settings.quad) throw new Error('Part generation does not support quad topology');
            if (settings.smartLowPoly) throw new Error('Part generation is incompatible with smart low-poly');
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

    function buildModelPayload(inputOrInputs, settings, isMultiview = false) {
        const payload = isMultiview ? { inputs: inputOrInputs } : { input: inputOrInputs };
        payload.model = settings.model;
        if (settings.generateParts) {
            payload.generate_parts = true;
            payload.texture = false;
            payload.pbr = false;
        } else {
            payload.texture = true;
            payload.pbr = true;
            payload.texture_quality = settings.textureQuality || 'standard';
            if (settings.model !== 'v2.5-20250123') {
                payload.texture_version = 'v3.5-20260815';
                payload.delight = settings.delight !== false;
            }
            if (settings.textureAlignment) payload.texture_alignment = settings.textureAlignment;
            if (settings.orientation) payload.orientation = settings.orientation;
        }
        if (settings.quad && settings.model !== 'P1-20260311' && settings.model !== 'v2.5-20250123') {
            payload.quad = true;
        }
        if (settings.geometryQuality && ['v3.1-20260211', 'v3.0-20250812'].includes(settings.model)) {
            payload.geometry_quality = settings.geometryQuality;
        }
        if (settings.smartLowPoly) payload.smart_low_poly = true;
        if (settings.enableImageAutofix) payload.enable_image_autofix = true;
        if (settings.faceLimit !== '') payload.face_limit = Number(settings.faceLimit);
        if (settings.modelSeed !== undefined && settings.modelSeed !== '') payload.model_seed = Number(settings.modelSeed);
        if (settings.textureSeed !== undefined && settings.textureSeed !== '') payload.texture_seed = Number(settings.textureSeed);
        if (settings.autoSize) payload.auto_size = true;
        if (settings.compress) payload.compress = settings.compress;
        if (settings.customParams && typeof settings.customParams === 'object') {
            for (const [k, v] of Object.entries(settings.customParams)) {
                if (!(k in payload)) payload[k] = v;
            }
        }
        return payload;
    }

    function imageToModelPayload(input, settings) {
        return buildModelPayload(input, settings, false);
    }

    function modelPayload(inputs, settings) {
        return buildModelPayload(inputs, settings, true);
    }

    function viewInputs(tokens) {
        return VIEWS.filter(view => tokens[view]).map(view => ({ [view]: tokens[view] }));
    }

    function convertPayload(taskId, settings) {
        const payload = { input: taskId, format: settings.format.toUpperCase(), bake: settings.bake };
        if (settings.bake && settings.textureSize) {
            payload.texture_size = Number(settings.textureSize);
        }
        if (settings.quad) {
            payload.quad = true;
            if (settings.forceSymmetry) payload.force_symmetry = true;
            if (settings.faceLimit !== '') payload.face_limit = Number(settings.faceLimit);
        }
        if (settings.format === 'fbx') payload.fbx_preset = settings.fbxPreset || 'mixamo';
        return payload;
    }

    function segmentPayload(taskId, options = {}) {
        const payload = { input: taskId };
        if (options.model) payload.model = options.model;
        if (options.granularity) payload.segmentation_granularity = options.granularity;
        if (options.splitByConnectivity !== undefined) payload.split_by_connectivity = options.splitByConnectivity;
        return payload;
    }

    function parseJsonConfig(raw) {
        let parsed;
        if (typeof raw === 'string') {
            try {
                parsed = JSON.parse(raw);
            } catch (err) {
                throw new Error(`JSON parse error: ${err.message}`);
            }
        } else if (raw && typeof raw === 'object') {
            parsed = raw;
        } else {
            throw new Error('Expected JSON string or object');
        }

        const result = {};
        const known = {
            model: ['model', 'model_version', 'modelVersion'],
            inputType: ['inputType', 'input_type', 'type', 'starting_point', 'startingPoint'],
            format: ['format', 'output_format', 'outputFormat'],
            faceLimit: ['faceLimit', 'face_limit'],
            quad: ['quad'],
            forceSymmetry: ['forceSymmetry', 'force_symmetry'],
            bake: ['bake'],
            textureSize: ['textureSize', 'texture_size'],
            textureQuality: ['textureQuality', 'texture_quality'],
            geometryQuality: ['geometryQuality', 'geometry_quality'],
            delight: ['delight'],
            smartLowPoly: ['smartLowPoly', 'smart_low_poly'],
            generateParts: ['generateParts', 'generate_parts'],
            enableImageAutofix: ['enableImageAutofix', 'enable_image_autofix', 'autofix'],
            textureAlignment: ['textureAlignment', 'texture_alignment'],
            orientation: ['orientation'],
            autoRig: ['autoRig', 'auto_rig', 'rig'],
            rigSpec: ['rigSpec', 'rig_spec', 'spec'],
            segment: ['segment', 'segmentation']
        };

        const handledKeys = new Set();
        for (const [field, aliases] of Object.entries(known)) {
            for (const alias of aliases) {
                if (alias in parsed) {
                    result[field] = parsed[alias];
                    handledKeys.add(alias);
                    break;
                }
            }
        }

        const customParams = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (!handledKeys.has(key) && !['input', 'inputs', 'files', 'prompt'].includes(key)) {
                customParams[key] = value;
            }
        }
        if (Object.keys(customParams).length > 0) {
            result.customParams = customParams;
        }
        return result;
    }

    function exportJsonConfig(settings) {
        const out = {
            model: settings.model || 'v3.1-20260211',
            inputType: settings.inputType || 'side',
            format: settings.format || 'fbx',
            faceLimit: settings.faceLimit !== undefined && settings.faceLimit !== '' ? Number(settings.faceLimit) : null,
            geometryQuality: settings.geometryQuality || 'standard',
            textureQuality: settings.textureQuality || 'standard',
            textureSize: settings.textureSize ? Number(settings.textureSize) : 2048,
            bake: settings.bake !== false,
            quad: !!settings.quad,
            forceSymmetry: !!settings.forceSymmetry,
            delight: settings.delight !== false,
            autoRig: !!settings.autoRig,
            rigSpec: settings.rigSpec || 'mixamo',
            segment: !!settings.segment
        };
        if (settings.smartLowPoly) out.smartLowPoly = true;
        if (settings.generateParts) out.generateParts = true;
        if (settings.enableImageAutofix) out.enableImageAutofix = true;
        if (settings.textureAlignment) out.textureAlignment = settings.textureAlignment;
        if (settings.orientation) out.orientation = settings.orientation;
        if (settings.customParams) Object.assign(out, settings.customParams);
        return JSON.stringify(out, null, 2);
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

    return { MAX_IMAGE_BYTES, MODEL_INFO, MODEL_COST, FACE_RANGES, FORMATS, VIEWS,
        TEXTURE_QUALITIES, GEOMETRY_QUALITIES, RIG_SPECS, faceRange,
        estimateCredits, validateImage, validateSettings, imageToModelPayload, modelPayload,
        viewInputs, convertPayload, segmentPayload, parseJsonConfig, exportJsonConfig,
        resultUrl, allowedResultUrl };
});
