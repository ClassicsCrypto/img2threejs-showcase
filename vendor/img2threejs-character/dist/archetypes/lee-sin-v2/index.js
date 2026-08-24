import { addSemanticNode, addSemanticRelation } from "../../ir/semantic-graph.js";
import { createHumanoidCharacterIR } from "../humanoid/index.js";
const Q = [0, 0, 0, 1];
const ARM_LEFT_Q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
const ARM_RIGHT_Q = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];
const FOOT_Q = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const LEFT_A_POSE_Q = [0, 0, -Math.sin(0.532), Math.cos(0.532)];
const RIGHT_A_POSE_Q = [0, 0, Math.sin(0.532), Math.cos(0.532)];
export function createLeeSinV2CharacterIR(options = {}) {
    const ir = createHumanoidCharacterIR({
        name: options.name ?? "Lee Sin v2",
        profile: options.profile ?? "standard",
        addShirt: false,
    });
    ir.meta.id = "lee-sin-v2";
    ir.meta.version = "2.0.0";
    ir.meta.sourceRefs = [
        "reconstructions/lee-sin-v2/references/lee-sin-v2-turnaround.png",
        "reconstructions/lee-sin-v2/references/lee-sin-v2-t-pose.png",
    ];
    ir.meta.assumptions = [
        "Turnaround is authoritative for visible design; T-pose is authoritative for bind-pose placement.",
        "Eye shape remains inferred because the opaque blindfold occludes the eye region.",
        "Hoop supports are short belt loops because attachment hardware is unresolved in the drawings.",
    ];
    ir.meta.nonGoals = ["photoreal skin", "strand simulation", "cloth physics", "exact hidden-eye likeness", "toon-outline post-process"];
    ir.archetype.baseFamily = "stylized-humanoid";
    ir.archetype.traits = ["low-poly", "athletic", "martial-artist", "blindfolded", "animation-ready"];
    Object.assign(ir.proportionModel, {
        stature: 1.18,
        headScale: 0.184,
        shoulderBreadth: 0.39,
        thoraxWidth: 0.25,
        thoraxDepth: 0.145,
        waistWidth: 0.15,
        pelvisWidth: 0.19,
        armSpan: 1.31,
        upperArmLength: 0.19,
        forearmLength: 0.18,
        handLength: 0.09,
        thighLength: 0.27,
        lowerLegLength: 0.25,
        footLength: 0.14,
    });
    ir.proportionModel.customSegments = [
        { id: "crown-to-chin", length: 0.18, width: 0.18, depth: 0.15, confidence: 0.93 },
        { id: "shoulder-to-waist", length: 0.3, width: 0.31, depth: 0.145, confidence: 0.95 },
        { id: "cropped-trouser", length: 0.38, width: 0.18, depth: 0.11, confidence: 0.94 },
    ];
    ir.proportionBindings = [
        {
            id: "lee-sin-arm-span",
            proportion: "armSpan",
            referenceValue: 1.31,
            targets: [
                { kind: "loft-section-center", ids: ["left-arm", "right-arm", "left-hand", "right-hand"], axes: ["x"] },
                { kind: "rig-joint-position", ids: ["left-shoulder", "left-elbow", "left-forearm", "left-wrist", "left-hand", "left-finger", "right-shoulder", "right-elbow", "right-forearm", "right-wrist", "right-hand", "right-finger"], axes: ["x"] },
                { kind: "accessory-position", ids: ["left-wrist-wrap", "right-wrist-wrap", "left-upper-arm-mark", "right-upper-arm-mark", "left-forearm-mark", "right-forearm-mark"], axes: ["x"] },
                { kind: "landmark-position", ids: ["left-shoulder", "right-shoulder", "left-wrist", "right-wrist"], axes: ["x"] },
                { kind: "hand-digit-point", handIds: ["left-hand-shape", "right-hand-shape"], axes: ["x"] },
            ],
        },
    ];
    ir.shapeGraph.lofts = leeSinBodyLofts();
    ir.shapeGraph.hands = leeSinHands();
    ir.shapeGraph.face = {
        skull: { center: [0, 1.1, 0], radius: [0.079, 0.09, 0.062], jawWidth: 0.067, jawDepth: 0.05 },
        landmarks: [
            { id: "hairline", role: "hairline", position: [0, 1.16, 0.054], confidence: 0.91 },
            { id: "eye-line", role: "eye-line-occluded", position: [0, 1.126, 0.063], confidence: 0.55 },
            { id: "nose-base", role: "nose-base", position: [0, 1.09, 0.071], confidence: 0.87 },
            { id: "mouth-line", role: "mouth-line", position: [0, 1.058, 0.064], confidence: 0.8 },
        ],
        curves: [],
        patches: [],
        expressionZones: [],
        morphSet: ir.morphGraph?.definitions ?? [],
    };
    ir.shapeGraph.curves = [];
    ir.shapeGraph.implicitFields = [];
    ir.shapeGraph.patches = [];
    ir.rigGraph = leeSinRig();
    ir.runtimeGraph.stableJointNames = ir.rigGraph.joints.map((joint) => joint.id);
    ir.runtimeGraph.stableMorphNames = ir.morphGraph?.definitions.map((morph) => morph.id) ?? [];
    ir.runtimeGraph.poseProfiles = [
        { id: "bind-t-pose", role: "bind", joints: {} },
        { id: "turnaround-a-pose", role: "design", joints: { "left-shoulder": LEFT_A_POSE_Q, "right-shoulder": RIGHT_A_POSE_Q } },
    ];
    ir.deformationGraph = {
        skinning: { strategy: "semantic-region", maxInfluences: 4, normalize: true },
        jointCorrectives: [
            { id: "left-elbow-corrective", region: "left-arm", driver: "left-elbow.angle", threshold: 0.35, maxWeight: 1 },
            { id: "right-elbow-corrective", region: "right-arm", driver: "right-elbow.angle", threshold: 0.35, maxWeight: 1 },
            { id: "left-knee-corrective", region: "left-leg", driver: "left-knee.angle", threshold: 0.35, maxWeight: 1 },
        ],
        twistDistribution: [
            { id: "left-forearm-twist", sourceJoint: "left-forearm", targetJoints: ["left-wrist"], distribution: [1] },
            { id: "right-forearm-twist", sourceJoint: "right-forearm", targetJoints: ["right-wrist"], distribution: [1] },
        ],
        volumePreservation: [
            { region: "left-arm", joint: "left-elbow", preserve: 0.9 },
            { region: "right-arm", joint: "right-elbow", preserve: 0.9 },
            { region: "left-leg", joint: "left-knee", preserve: 0.92 },
            { region: "right-leg", joint: "right-knee", preserve: 0.92 },
        ],
        muscleDrivers: [],
        morphDrivers: [],
        surfaceFollowers: [],
    };
    ir.appearanceGraph.materials = leeSinMaterials();
    ir.appearanceGraph.variants = {
        reference: {
            skin: { baseColor: [0.64, 0.39, 0.21], roughness: 0.6 },
            "red-cloth": { baseColor: [0.52, 0.045, 0.03], roughness: 0.7 },
            gold: { baseColor: [1, 0.7, 0.08], roughness: 0.38, metalness: 0.55 },
        },
    };
    ir.surfaceGraph.features = leeSinSurfaceFeatures();
    ir.surfaceGraph.coordinates = {};
    ir.surfaceGraph.uvStrategy = "semantic-region";
    ir.fiberGraph = { definitions: leeSinHairFibers() };
    ir.wearableGraph = {
        items: [
            { id: "cropped-trousers", kind: "pants", covers: ["pelvis", "left-leg", "right-leg"], attachmentMode: "skins-with", offset: 0.006, materialId: "dark-cloth", seamIds: ["waist", "left-cuff", "right-cuff"], foldStrength: 0.18 },
            { id: "blindfold", kind: "accessory", covers: ["eyes", "temples", "rear-head"], attachmentMode: "bone-attaches", offset: 0.003, materialId: "red-cloth", seamIds: ["rear-knot"], foldStrength: 0.08, sourceAccessoryIds: ["blindfold-front", "blindfold-left-wrap", "blindfold-right-wrap", "blindfold-rear", "blindfold-knot", "blindfold-tail-left", "blindfold-tail-right"] },
        ],
    };
    ir.appendageGraph = { items: [] };
    ir.accessoryGraph = { items: leeSinAccessories() };
    for (const accessory of ir.accessoryGraph.items) {
        addSemanticNode(ir.semanticGraph, { id: accessory.id, kind: accessory.layer === "L5" ? "surface-marking" : "accessory", metadata: { joint: accessory.jointId ?? "root" } });
        addSemanticRelation(ir.semanticGraph, "character", accessory.id, "parent");
    }
    ir.landmarkGraph.landmarks = [...ir.shapeGraph.face.landmarks];
    ir.landmarkGraph.semanticToId = { hairline: "hairline", eyeLine: "eye-line", noseBase: "nose-base", mouthLine: "mouth-line" };
    ir.evidence = leeSinEvidence();
    ir.optimizationGraph.materialBudget = 12;
    ir.optimizationGraph.boneBudget = 64;
    ir.optimizationGraph.morphBudget = 24;
    ir.validationGraph.requiredGates = [
        "G0-EVIDENCE",
        "G1-PROPORTION",
        "GEO-DEGENERATE",
        "GEO-WATERTIGHT",
        "SURF-UV-VALID",
        "RIG-HIERARCHY",
        "RIG-WEIGHT-SUM",
        "ACCESSORY-ATTACHMENT",
        "RUNTIME-API",
    ];
    ir.validationGraph.thresholds = {
        maxDegenerateVertices: 0,
        maxWeightError: 0.001,
        maxAccessoryJointErrors: 0,
        maxWearablePenetration: 0.002,
    };
    return ir;
}
function leeSinBodyLofts() {
    return [
        loft("torso", "thorax", [
            section(0, [0, 0.65, 0], 0.095, 0.071),
            section(0.22, [0, 0.72, 0], 0.115, 0.079),
            section(0.52, [0, 0.81, 0], 0.148, 0.089),
            section(0.8, [0, 0.9, 0], 0.168, 0.095),
            section(1, [0, 0.96, 0], 0.14, 0.082),
        ], "skin"),
        loft("neck", "neck", [section(0, [0, 0.965, 0], 0.052, 0.048), section(1, [0, 1.03, 0], 0.047, 0.044)], "skin"),
        loft("left-arm", "left-arm", armSections(1), "skin"),
        loft("right-arm", "right-arm", armSections(-1), "skin"),
        loft("left-hand", "left-hand", handSections(1), "skin"),
        loft("right-hand", "right-hand", handSections(-1), "skin"),
        loft("pelvis-shorts", "pelvis", [
            section(0, [0, 0.57, 0], 0.112, 0.088),
            section(0.5, [0, 0.62, 0], 0.118, 0.091),
            section(1, [0, 0.67, 0], 0.103, 0.083),
        ], "skin"),
        loft("left-cropped-trouser", "left-leg", trouserSections(1), "skin"),
        loft("right-cropped-trouser", "right-leg", trouserSections(-1), "skin"),
        loft("left-lower-leg", "left-lower-leg", lowerLegSections(1), "dark-cloth"),
        loft("right-lower-leg", "right-lower-leg", lowerLegSections(-1), "dark-cloth"),
        loft("left-foot", "left-foot", footSections(1), "skin"),
        loft("right-foot", "right-foot", footSections(-1), "skin"),
    ];
}
function armSections(side) {
    const orientation = side === 1 ? ARM_LEFT_Q : ARM_RIGHT_Q;
    return [
        section(0, [side * 0.17, 0.865, 0], 0.085, 0.071, orientation),
        section(0.18, [side * 0.23, 0.865, 0], 0.075, 0.064, orientation),
        section(0.42, [side * 0.32, 0.865, 0], 0.061, 0.055, orientation),
        section(0.54, [side * 0.37, 0.865, 0], 0.05, 0.046, orientation),
        section(0.75, [side * 0.455, 0.865, 0], 0.054, 0.048, orientation),
        section(1, [side * 0.563, 0.865, 0], 0.038, 0.036, orientation),
    ];
}
function handSections(side) {
    const orientation = side === 1 ? ARM_LEFT_Q : ARM_RIGHT_Q;
    return [
        section(0, [side * 0.563, 0.865, 0], 0.035, 0.032, orientation),
        section(0.55, [side * 0.592, 0.865, 0.006], 0.034, 0.026, orientation),
        section(1, [side * 0.615, 0.865, 0.012], 0.026, 0.019, orientation),
    ];
}
function leeSinHands() {
    const hand = (side) => {
        const sideName = side === 1 ? "left" : "right";
        const digit = (id, jointId, points, radiusStart, radiusEnd) => ({ id: `${sideName}-${id}`, jointId: `${sideName}-${jointId}`, points, radiusStart, radiusEnd, sides: 6 });
        return {
            id: `${sideName}-hand-shape`,
            loftId: `${sideName}-hand`,
            digits: [
                digit("index-digit", "finger", [[side * 0.6, 0.875, 0.004], [side * 0.632, 0.879, 0.006], [side * 0.65, 0.876, 0.005]], 0.012, 0.006),
                digit("middle-digit", "finger", [[side * 0.602, 0.864, 0.01], [side * 0.638, 0.864, 0.012], [side * 0.655, 0.86, 0.01]], 0.0125, 0.006),
                digit("ring-digit", "finger", [[side * 0.6, 0.852, 0.005], [side * 0.63, 0.85, 0.006], [side * 0.646, 0.846, 0.004]], 0.011, 0.0055),
                digit("thumb-digit", "hand", [[side * 0.592, 0.85, 0.014], [side * 0.61, 0.825, 0.018], [side * 0.625, 0.81, 0.015]], 0.013, 0.007),
            ],
        };
    };
    return [hand(1), hand(-1)];
}
function trouserSections(side) {
    return [
        section(0, [side * 0.08, 0.61, 0], 0.085, 0.071),
        section(0.28, [side * 0.087, 0.51, 0], 0.082, 0.071),
        section(0.58, [side * 0.09, 0.41, 0], 0.078, 0.067),
        section(0.82, [side * 0.09, 0.315, 0], 0.073, 0.062),
        section(1, [side * 0.088, 0.28, 0], 0.067, 0.056),
    ];
}
function lowerLegSections(side) {
    return [
        section(0, [side * 0.077, 0.29, 0], 0.049, 0.045),
        section(0.45, [side * 0.077, 0.18, 0], 0.043, 0.04),
        section(1, [side * 0.077, 0.09, 0.004], 0.038, 0.037),
    ];
}
function footSections(side) {
    return [
        section(0, [side * 0.077, 0.06, 0.01], 0.044, 0.032, FOOT_Q),
        section(0.5, [side * 0.077, 0.045, 0.074], 0.046, 0.032, FOOT_Q),
        section(1, [side * 0.077, 0.04, 0.14], 0.041, 0.03, FOOT_Q),
    ];
}
function section(t, center, width, depth, orientation = Q) {
    const contour = [];
    for (let index = 0; index < 12; index += 1) {
        const angle = index / 12 * Math.PI * 2;
        contour.push([Math.cos(angle), Math.sin(angle)]);
    }
    return { t, center, orientation, contour, width, depth, landmarks: [], anatomicalInfluences: [], deformationZone: undefined };
}
function loft(id, region, sections, materialId) {
    return {
        id,
        region,
        axis: { id: `${id}-axis`, role: "anatomical-axis", points: sections.map((item) => item.center) },
        sections,
        continuityConstraints: [],
        topologyIntent: "deformable-organic",
        materialId,
    };
}
function leeSinRig() {
    const joint = (id, parentId, role, restPosition) => ({ id, parentId, role, restPosition, restRotation: Q, axis: [0, 1, 0] });
    const joints = [
        joint("root", undefined, "root", [0, 0, 0]),
        joint("spine", "root", "spine", [0, 0.44, 0]),
        joint("chest", "spine", "thorax", [0, 0.76, 0]),
        joint("neck", "chest", "neck", [0, 0.97, 0]),
        joint("head", "neck", "head", [0, 1.08, 0]),
        joint("left-shoulder", "chest", "shoulder", [0.195, 0.865, 0]),
        joint("left-elbow", "left-shoulder", "elbow", [0.38, 0.865, 0]),
        joint("left-forearm", "left-elbow", "forearm", [0.46, 0.865, 0]),
        joint("left-wrist", "left-forearm", "wrist", [0.563, 0.865, 0]),
        joint("left-hand", "left-wrist", "hand", [0.615, 0.865, 0.006]),
        joint("left-finger", "left-hand", "finger", [0.655, 0.865, 0.012]),
        joint("right-shoulder", "chest", "shoulder", [-0.195, 0.865, 0]),
        joint("right-elbow", "right-shoulder", "elbow", [-0.38, 0.865, 0]),
        joint("right-forearm", "right-elbow", "forearm", [-0.46, 0.865, 0]),
        joint("right-wrist", "right-forearm", "wrist", [-0.563, 0.865, 0]),
        joint("right-hand", "right-wrist", "hand", [-0.615, 0.865, 0.006]),
        joint("right-finger", "right-hand", "finger", [-0.655, 0.865, 0.012]),
        joint("left-hip", "root", "hip", [0.07, 0.61, 0]),
        joint("left-knee", "left-hip", "knee", [0.075, 0.35, 0]),
        joint("left-ankle", "left-knee", "ankle", [0.075, 0.1, 0]),
        joint("left-foot", "left-ankle", "foot", [0.075, 0.06, 0.02]),
        joint("left-toe", "left-foot", "toe", [0.075, 0.055, 0.14]),
        joint("right-hip", "root", "hip", [-0.07, 0.61, 0]),
        joint("right-knee", "right-hip", "knee", [-0.075, 0.35, 0]),
        joint("right-ankle", "right-knee", "ankle", [-0.075, 0.1, 0]),
        joint("right-foot", "right-ankle", "foot", [-0.075, 0.06, 0.02]),
        joint("right-toe", "right-foot", "toe", [-0.075, 0.055, 0.14]),
    ];
    return {
        joints,
        chains: [
            { id: "left-arm", joints: ["left-shoulder", "left-elbow", "left-forearm", "left-wrist", "left-hand", "left-finger"], role: "arm" },
            { id: "right-arm", joints: ["right-shoulder", "right-elbow", "right-forearm", "right-wrist", "right-hand", "right-finger"], role: "arm" },
            { id: "left-leg", joints: ["left-hip", "left-knee", "left-ankle", "left-foot", "left-toe"], role: "leg" },
            { id: "right-leg", joints: ["right-hip", "right-knee", "right-ankle", "right-foot", "right-toe"], role: "leg" },
        ],
        constraints: [
            { joint: "left-elbow", type: "hinge", axis: [1, 0, 0], min: 0, max: Math.PI * 0.9 },
            { joint: "right-elbow", type: "hinge", axis: [1, 0, 0], min: 0, max: Math.PI * 0.9 },
            { joint: "left-knee", type: "hinge", axis: [1, 0, 0], min: 0, max: Math.PI * 0.9 },
            { joint: "right-knee", type: "hinge", axis: [1, 0, 0], min: 0, max: Math.PI * 0.9 },
        ],
        effectors: [
            { id: "left-hand", joint: "left-hand" },
            { id: "right-hand", joint: "right-hand" },
            { id: "left-foot", joint: "left-foot" },
            { id: "right-foot", joint: "right-foot" },
        ],
        twistSystems: [],
        drivers: [],
        ikChains: [
            { id: "left-arm-ik", joints: ["left-shoulder", "left-elbow", "left-forearm", "left-wrist", "left-hand"], effector: "left-hand", target: "left-hand-target", solverHint: "ccd" },
            { id: "right-arm-ik", joints: ["right-shoulder", "right-elbow", "right-forearm", "right-wrist", "right-hand"], effector: "right-hand", target: "right-hand-target", solverHint: "ccd" },
        ],
    };
}
function leeSinSurfaceFeatures() {
    const feature = (id, region) => ({ id, region, representation: "decal", materialId: "red-cloth", sourceAccessoryId: id, intensity: 1 });
    return [
        feature("chest-chevron-left-upper", "thorax"),
        feature("chest-chevron-left-lower", "thorax"),
        feature("chest-chevron-right-upper", "thorax"),
        feature("chest-chevron-right-lower", "thorax"),
        feature("left-upper-arm-mark", "left-arm"),
        feature("right-upper-arm-mark", "right-arm"),
        feature("left-forearm-mark", "left-arm"),
        feature("right-forearm-mark", "right-arm"),
    ];
}
function leeSinHairFibers() {
    const make = (id, radius, guides, representation = "lock") => {
        const roots = guides.map((guide, index) => ({ id: `${guide.id}-root`, emitter: "scalp", coordinate: { region: "scalp", u: (index + 1) / (guides.length + 1), v: 0.75, normalOffset: 0.002 }, normalOffset: 0.002 }));
        return {
            id,
            kind: "hair",
            materialId: "hair",
            representation,
            radius,
            lod: [1, 0.55, 0.25],
            flow: {
                emitter: "scalp",
                roots,
                directionalField: { id: `${id}-flow`, type: "constant", parameters: { x: 0, y: 1, z: 0 } },
                guides: guides.map((guide, index) => ({ id: guide.id, rootId: roots[index].id, points: guide.points, taper: guide.taper })),
                clumps: [{ id: `${id}-clump`, guideIds: guides.map((guide) => guide.id), spread: 0.01, strandCount: guides.length }],
                modifiers: { gravity: 0.08, attraction: 0.75, spread: 0.08 },
            },
        };
    };
    return [
        make("scalp-hair-mass", 0.033, [
            { id: "scalp-center", points: [[0, 1.125, -0.03], [0, 1.178, -0.024]], taper: 0.08 },
            { id: "scalp-front", points: [[0, 1.125, 0.03], [0, 1.178, 0.024]], taper: 0.08 },
            { id: "scalp-left", points: [[0.043, 1.12, -0.018], [0.034, 1.169, -0.017]], taper: 0.18 },
            { id: "scalp-right", points: [[-0.043, 1.12, -0.018], [-0.034, 1.169, -0.017]], taper: 0.18 },
            { id: "scalp-rear", points: [[0, 1.112, -0.057], [0.006, 1.163, -0.052]], taper: 0.16 },
        ], "shell"),
        make("topknot-hair", 0.031, [{ id: "topknot-guide", points: [[0.012, 1.19, -0.03], [0.018, 1.222, -0.031]], taper: 0.1 }], "shell"),
        make("front-fringe-hair", 0.017, [{ id: "front-fringe-guide", points: [[-0.018, 1.174, 0.03], [-0.038, 1.137, 0.05], [-0.052, 1.102, 0.055]], taper: 0.48 }]),
        make("side-lock-hair", 0.016, [
            { id: "left-lock-guide", points: [[0.046, 1.158, 0.003], [0.055, 1.12, 0.009]], taper: 0.35 },
            { id: "right-lock-guide", points: [[-0.046, 1.158, 0.002], [-0.055, 1.116, 0.007]], taper: 0.35 },
        ], "shell"),
    ];
}
function leeSinMaterials() {
    return [
        { id: "skin", semanticType: "skin", baseColor: [0.64, 0.39, 0.21], roughness: 0.6, metalness: 0, clearcoat: 0.06, flatShading: true, skin: { baseColor: [0.64, 0.39, 0.21], roughness: 0.6, thickness: 0.35 } },
        { id: "eye-sclera", semanticType: "eye", baseColor: [0.82, 0.75, 0.62], roughness: 0.3, metalness: 0 },
        { id: "eye-iris", semanticType: "eye", baseColor: [0.09, 0.05, 0.025], roughness: 0.25, metalness: 0 },
        { id: "eye-pupil", semanticType: "eye", baseColor: [0.005, 0.003, 0.002], roughness: 0.2, metalness: 0 },
        { id: "hair", semanticType: "hair", baseColor: [0.018, 0.02, 0.022], roughness: 0.42, metalness: 0, anisotropy: 0.35, flatShading: true },
        { id: "red-cloth", semanticType: "cloth", baseColor: [0.52, 0.045, 0.03], roughness: 0.7, metalness: 0, flatShading: true },
        { id: "dark-cloth", semanticType: "cloth", baseColor: [0.055, 0.06, 0.075], roughness: 0.82, metalness: 0, sheen: 0.16, flatShading: true },
        { id: "brown-leather", semanticType: "leather", baseColor: [0.27, 0.13, 0.08], roughness: 0.74, metalness: 0, clearcoat: 0.04, flatShading: true },
        { id: "gold", semanticType: "custom", baseColor: [1, 0.7, 0.08], roughness: 0.38, metalness: 0.55, clearcoat: 0.14, flatShading: true },
    ];
}
function leeSinAccessories() {
    const items = [
        accessory("hair-cap", "fiber-anchor-hair-cap", "L3", "anchor", "hair", [0, 1.143, -0.018], { jointId: "head" }),
        accessory("rear-hair-mass", "fiber-anchor-rear-hair", "L3", "anchor", "hair", [0, 1.135, -0.062], { jointId: "head" }),
        accessory("topknot", "fiber-anchor-topknot", "L3", "anchor", "hair", [0.025, 1.218, -0.035], { jointId: "head" }),
        accessory("front-fringe-main", "fiber-anchor-fringe-main", "L3", "anchor", "hair", [-0.05, 1.145, 0.047], { jointId: "head" }),
        accessory("front-fringe-tip", "fiber-anchor-fringe-tip", "L3", "anchor", "hair", [-0.068, 1.105, 0.066], { jointId: "head" }),
        accessory("left-side-lock", "fiber-anchor-left-lock", "L3", "anchor", "hair", [0.064, 1.128, 0.006], { jointId: "head" }),
        accessory("right-side-lock", "fiber-anchor-right-lock", "L3", "anchor", "hair", [-0.067, 1.123, 0], { jointId: "head" }),
        accessory("hair-tie", "topknot-tie", "L3", "cylinder", "red-cloth", [0.018, 1.195, -0.024], { size: [0.027, 0.014, 0.027], radius: 0.027, rotation: [0, 0, Math.PI / 2], jointId: "head", radialSegments: 8, explodeWithParent: false }),
        accessory("blindfold-front", "blindfold-front-band", "L3", "box", "red-cloth", [0, 1.127, 0.07], { size: [0.14, 0.047, 0.014], jointId: "head", explodeWithParent: false }),
        accessory("blindfold-left-wrap", "blindfold-side-wrap", "L3", "box", "red-cloth", [0.073, 1.127, 0.01], { size: [0.016, 0.046, 0.1], jointId: "head", explodeWithParent: false }),
        accessory("blindfold-right-wrap", "blindfold-side-wrap", "L3", "box", "red-cloth", [-0.073, 1.127, 0.01], { size: [0.016, 0.046, 0.1], jointId: "head", explodeWithParent: false }),
        accessory("blindfold-rear", "blindfold-rear-band", "L3", "box", "red-cloth", [0, 1.127, -0.064], { size: [0.13, 0.045, 0.014], jointId: "head", explodeWithParent: false }),
        accessory("blindfold-knot", "blindfold-knot", "L3", "dodecahedron", "red-cloth", [0, 1.13, -0.086], { size: [0.021, 0.021, 0.016], jointId: "head", flatShading: true, explodeWithParent: false }),
        polygon("blindfold-tail-left", "blindfold-tail", "L3", "red-cloth", [-0.019, 1.056, -0.087], [[-0.012, 0.058], [0.012, 0.058], [0.009, -0.058], [-0.016, -0.05]], "head"),
        polygon("blindfold-tail-right", "blindfold-tail", "L3", "red-cloth", [0.019, 1.052, -0.089], [[-0.011, 0.062], [0.013, 0.058], [0.016, -0.054], [-0.009, -0.062]], "head"),
        accessory("left-ear", "ear", "L2", "ellipsoid", "skin", [0.083, 1.116, 0.004], { size: [0.015, 0.029, 0.013], jointId: "head", flatShading: true, radialSegments: 6, tubularSegments: 8 }),
        accessory("right-ear", "ear", "L2", "ellipsoid", "skin", [-0.083, 1.116, 0.004], { size: [0.015, 0.029, 0.013], jointId: "head", flatShading: true, radialSegments: 6, tubularSegments: 8 }),
        accessory("nose-wedge", "nose", "L2", "cone", "skin", [0, 1.09, 0.075], { size: [0.014, 0.03, 0.014], radius: 0.014, rotation: [Math.PI / 2, 0, 0], jointId: "head", flatShading: true, radialSegments: 4 }),
        accessory("waist-sash", "waist-sash", "L4", "cylinder", "red-cloth", [0, 0.67, 0], { size: [0.112, 0.046, 0.112], radius: 0.112, scale: [1, 1, 0.65], jointId: "chest", radialSegments: 10, explodeWithParent: false }),
        accessory("waist-diagonal", "diagonal-sash-tail", "L4", "box", "red-cloth", [0.018, 0.642, 0.075], { size: [0.205, 0.024, 0.018], rotation: [0, 0, -0.15], jointId: "left-hip", explodeWithParent: false }),
        accessory("left-thigh-wrap-upper", "thigh-wrap", "L3", "cylinder", "red-cloth", [0.09, 0.49, 0], { size: [0.096, 0.03, 0.096], radius: 0.096, scale: [1, 1, 0.82], jointId: "left-hip", radialSegments: 10 }),
        accessory("left-thigh-wrap-lower", "thigh-wrap", "L3", "cylinder", "red-cloth", [0.09, 0.447, 0], { size: [0.094, 0.028, 0.094], radius: 0.094, scale: [1, 1, 0.82], jointId: "left-hip", radialSegments: 10 }),
        accessory("right-thigh-wrap-upper", "thigh-wrap", "L3", "cylinder", "red-cloth", [-0.09, 0.49, 0], { size: [0.096, 0.03, 0.096], radius: 0.096, scale: [1, 1, 0.82], jointId: "right-hip", radialSegments: 10 }),
        accessory("right-thigh-wrap-lower", "thigh-wrap", "L3", "cylinder", "red-cloth", [-0.09, 0.447, 0], { size: [0.094, 0.028, 0.094], radius: 0.094, scale: [1, 1, 0.82], jointId: "right-hip", radialSegments: 10 }),
        accessory("left-wrist-wrap", "wrist-wrap", "L3", "cylinder", "brown-leather", [0.552, 0.865, 0], { size: [0.043, 0.065, 0.043], radius: 0.043, rotation: [0, 0, Math.PI / 2], jointId: "left-wrist", radialSegments: 8 }),
        accessory("right-wrist-wrap", "wrist-wrap", "L3", "cylinder", "brown-leather", [-0.552, 0.865, 0], { size: [0.043, 0.065, 0.043], radius: 0.043, rotation: [0, 0, Math.PI / 2], jointId: "right-wrist", radialSegments: 8 }),
        accessory("left-ankle-wrap", "ankle-wrap", "L3", "cylinder", "brown-leather", [0.075, 0.105, 0], { size: [0.046, 0.035, 0.046], radius: 0.046, jointId: "left-ankle", radialSegments: 8 }),
        accessory("right-ankle-wrap", "ankle-wrap", "L3", "cylinder", "brown-leather", [-0.075, 0.105, 0], { size: [0.046, 0.035, 0.046], radius: 0.046, jointId: "right-ankle", radialSegments: 8 }),
        accessory("left-hoop-support", "hoop-support", "L3", "box", "brown-leather", [0.18, 0.765, 0], { size: [0.023, 0.045, 0.023], jointId: "left-hip", explodeWithParent: false }),
        accessory("right-hoop-support", "hoop-support", "L3", "box", "brown-leather", [-0.18, 0.765, 0], { size: [0.023, 0.045, 0.023], jointId: "right-hip", explodeWithParent: false }),
        accessory("rear-hoop-support", "hoop-support", "L3", "box", "brown-leather", [0, 0.775, -0.12], { size: [0.03, 0.032, 0.012], jointId: "chest", explodeWithParent: false }),
        accessory("left-side-hoop", "gold-side-hoop", "L3", "torus", "gold", [0.18, 0.72, 0], { size: [0.095, 0.008, 0.095], radius: 0.095, tube: 0.008, scale: [0.22, 1, 1], jointId: "left-hip", radialSegments: 6, tubularSegments: 20, flatShading: true, explodeWithParent: false }),
        accessory("right-side-hoop", "gold-side-hoop", "L3", "torus", "gold", [-0.18, 0.72, 0], { size: [0.095, 0.008, 0.095], radius: 0.095, tube: 0.008, scale: [0.22, 1, 1], jointId: "right-hip", radialSegments: 6, tubularSegments: 20, flatShading: true, explodeWithParent: false }),
        accessory("rear-hoop", "gold-rear-hoop", "L3", "torus", "gold", [0, 0.72, -0.11], { size: [0.082, 0.009, 0.082], radius: 0.082, tube: 0.009, jointId: "chest", radialSegments: 6, tubularSegments: 24, flatShading: true, explodeWithParent: false }),
    ];
    items.push(...chestChevrons(), ...armMarkings());
    return items;
}
function chestChevrons() {
    const points = [[-0.026, 0.014], [0, -0.012], [0.026, 0.014], [0.019, 0.021], [0, 0.002], [-0.019, 0.021]];
    return [
        polygon("chest-chevron-left-upper", "chest-marking", "L5", "red-cloth", [0.048, 0.97, 0.08], points, "chest", false),
        polygon("chest-chevron-left-lower", "chest-marking", "L5", "red-cloth", [0.048, 0.94, 0.079], points, "chest", false),
        polygon("chest-chevron-right-upper", "chest-marking", "L5", "red-cloth", [-0.048, 0.97, 0.08], points, "chest", false),
        polygon("chest-chevron-right-lower", "chest-marking", "L5", "red-cloth", [-0.048, 0.94, 0.079], points, "chest", false),
    ];
}
function armMarkings() {
    const slash = [[-0.032, 0.016], [0.022, -0.019], [0.032, -0.008], [-0.019, 0.027]];
    return [
        polygon("left-upper-arm-mark", "arm-marking", "L5", "red-cloth", [0.225, 0.892, 0.06], slash, "left-shoulder", false),
        polygon("right-upper-arm-mark", "arm-marking", "L5", "red-cloth", [-0.225, 0.892, 0.06], slash.map(([x, y]) => [-x, y]), "right-shoulder", false),
        polygon("left-forearm-mark", "forearm-marking", "L5", "red-cloth", [0.408, 0.882, 0.048], slash, "left-forearm", false),
        polygon("right-forearm-mark", "forearm-marking", "L5", "red-cloth", [-0.408, 0.882, 0.048], slash.map(([x, y]) => [-x, y]), "right-forearm", false),
    ];
}
function accessory(id, semanticRole, layer, primitive, materialId, position, options) {
    return { id, semanticRole, layer, primitive, materialId, position, space: "model", explodeWithParent: true, ...options };
}
function polygon(id, semanticRole, layer, materialId, position, points, jointId, doubleSided = true) {
    return accessory(id, semanticRole, layer, "polygon", materialId, position, { points, size: [1, 1, 0.003], jointId, doubleSided, flatShading: true });
}
function leeSinEvidence() {
    const landmarks = [
        ["crown", "crown", [0, 1.185, 0]],
        ["chin", "chin", [0, 1.01, 0.065]],
        ["left-shoulder", "left-shoulder", [0.195, 0.865, 0]],
        ["right-shoulder", "right-shoulder", [-0.195, 0.865, 0]],
        ["left-wrist", "left-wrist", [0.563, 0.865, 0]],
        ["right-wrist", "right-wrist", [-0.563, 0.865, 0]],
        ["left-hip", "left-hip", [0.07, 0.61, 0]],
        ["right-hip", "right-hip", [-0.07, 0.61, 0]],
        ["left-ankle", "left-ankle", [0.075, 0.1, 0]],
        ["right-ankle", "right-ankle", [-0.075, 0.1, 0]],
    ];
    return {
        camera: { projection: "orthographic", orthographicHalfHeight: 0.695, aspect: 1408 / 768, position: [0, 0.619, 2.6], target: [0, 0.619, 0], confidence: 0.88, sourceView: "turnaround-front" },
        captureProfiles: leeSinCaptureProfiles(),
        silhouettes: [
            { viewId: "turnaround-front", polygon: [[0.5, 0.04], [0.39, 0.23], [0.32, 0.54], [0.43, 0.96], [0.57, 0.96], [0.68, 0.54], [0.61, 0.23]], confidence: 0.95, observed: true },
            { viewId: "turnaround-side", polygon: [[0.5, 0.04], [0.44, 0.23], [0.43, 0.55], [0.47, 0.96], [0.56, 0.96], [0.58, 0.54], [0.57, 0.22]], confidence: 0.91, observed: true },
            { viewId: "turnaround-rear", polygon: [[0.5, 0.04], [0.39, 0.23], [0.34, 0.54], [0.43, 0.96], [0.57, 0.96], [0.66, 0.54], [0.61, 0.23]], confidence: 0.95, observed: true },
        ],
        landmarks: landmarks.map(([id, semanticRole, position]) => ({ id, semanticRole, position, confidence: 0.92, observed: true, sourceView: id.includes("wrist") ? "front-t-pose" : "turnaround-front" })),
        semanticRegions: [
            { id: "body", label: "bare athletic body", confidence: 0.98, observed: true },
            { id: "hair", label: "topknot and character-right fringe", confidence: 0.97, observed: true, parentId: "body" },
            { id: "blindfold", label: "opaque red blindfold", confidence: 0.99, observed: true, parentId: "body" },
            { id: "trousers", label: "dark cropped trousers", confidence: 0.99, observed: true, parentId: "body" },
            { id: "gold-hoops", label: "two side hoops and one rear hoop", confidence: 0.99, observed: true, parentId: "body" },
        ],
        pose: { jointAngles: {}, landmarks: landmarks.map(([id]) => id), restPoseConfidence: 0.98, confidence: 0.96 },
        proportions: [
            { id: "head-unit", ratio: 0.184, numerator: "head-height", denominator: "body-height", confidence: 0.93, observed: true },
            { id: "shoulder-breadth", ratio: 0.39, numerator: "shoulder-width", denominator: "body-height", confidence: 0.95, observed: true },
            { id: "arm-span", ratio: 1.31, numerator: "finger-span", denominator: "normalized-character-height", confidence: 0.92, observed: true },
        ],
        depthHints: [
            { region: "thorax", relativeDepth: 0.145, confidence: 0.88, sourceView: "turnaround-side" },
            { region: "head", relativeDepth: 0.15, confidence: 0.88, sourceView: "turnaround-side" },
            { region: "hair", relativeDepth: 0.18, confidence: 0.76, sourceView: "turnaround-side" },
        ],
        occlusionGraph: { edges: [{ occluder: "blindfold", occluded: "eyes", confidence: 1 }] },
        symmetry: { plane: "sagittal", score: 0.87, exceptions: ["character-right fringe", "waist diagonal", "rear blindfold tails"], confidence: 0.95 },
        crossSectionHints: [
            { region: "thorax", t: 0.7, width: 0.153, depth: 0.078, confidence: 0.9 },
            { region: "upper-arm", t: 0.2, width: 0.061, depth: 0.052, confidence: 0.87 },
            { region: "trouser-leg", t: 0.5, width: 0.09, depth: 0.056, confidence: 0.9 },
        ],
        materials: leeSinMaterials().filter((material) => !material.id.startsWith("eye-")).map((material) => ({ id: material.id, semanticType: material.semanticType, baseColor: material.baseColor, roughness: material.roughness, metalness: material.metalness, confidence: material.id === "gold" ? 0.78 : 0.72, sourceView: "turnaround" })),
        surfaceFeatures: [
            { id: "chest-chevron-pair", region: "thorax", representation: "decal", confidence: 0.99, observed: true },
            { id: "arm-markings", region: "arms", representation: "decal", confidence: 0.95, observed: true },
        ],
        fibers: [{ id: "solid-hair-masses", emitter: "scalp", flow: [-0.3, 0.5, 0.2], length: 0.12, density: 0.4, confidence: 0.91 }],
        wearables: [
            { id: "cropped-trousers", label: "dark cropped trousers", covers: ["pelvis", "left-leg", "right-leg"], attachment: "skins-with", confidence: 0.98 },
            { id: "blindfold", label: "red blindfold", covers: ["eyes", "temples", "rear-head"], attachment: "head-bone", confidence: 0.99 },
        ],
        uncertainty: {
            eyes: { confidence: 0.1, state: "unknown", reason: "occluded by blindfold" },
            "hair-top": { confidence: 0.55, state: "inferred", reason: "no top view" },
            "hoop-supports": { confidence: 0.5, state: "inferred", reason: "support hardware unresolved" },
            "body-proportions": { confidence: 0.93, state: "observed" },
        },
    };
}
function leeSinCaptureProfiles() {
    const camera = (sourceView, aspect, position, orthographicHalfHeight = 0.695, targetY = 0.619) => ({
        projection: "orthographic",
        orthographicHalfHeight,
        aspect,
        position,
        target: [0, targetY, 0],
        confidence: 0.88,
        sourceView,
    });
    return [
        { id: "bind-front", view: "front", authority: "bind-pose", poseProfileId: "bind-t-pose", camera: camera("front-t-pose", 1376 / 768, [0, 0.628, 2.6], 0.658, 0.628) },
        { id: "turnaround-front", view: "front", authority: "visible-design", poseProfileId: "turnaround-a-pose", camera: camera("turnaround-front", 1408 / 768, [0, 0.619, 2.6]) },
        { id: "turnaround-three-quarter", view: "three-quarter", authority: "visible-design", poseProfileId: "turnaround-a-pose", camera: camera("turnaround-three-quarter", 1408 / 768, [1.84, 0.619, 1.84]) },
        { id: "turnaround-side", view: "side", authority: "visible-design", poseProfileId: "turnaround-a-pose", camera: camera("turnaround-side", 1408 / 768, [2.6, 0.619, 0]) },
        { id: "turnaround-rear", view: "rear", authority: "visible-design", poseProfileId: "turnaround-a-pose", camera: camera("turnaround-rear", 1408 / 768, [0, 0.619, -2.6]) },
    ];
}
//# sourceMappingURL=index.js.map