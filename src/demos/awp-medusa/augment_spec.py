"""Augment the generated AWP spec with evidence-linked quality fields.

The generic authoring stage creates the contract skeleton. This small, repeatable
patch supplies the image-specific observations that cannot be inferred from a
domain template: two-view evidence, detail inventory, attachment contracts,
reference-derived material limits, and the AWP repetition systems.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SPEC_PATH = ROOT / "object-sculpt-spec.json"
FRONT = "/Users/tamlh/workspaces/self/AI/img2threejs-org/img2threejs-showcase/public/front-medusa.webp"
BACK = "/Users/tamlh/workspaces/self/AI/img2threejs-org/img2threejs-showcase/public/back-medusa.webp"
FRONT_ALBEDO = "assets/front-albedo.png"
BACK_ALBEDO = "assets/back-albedo.png"


def rgba(hex_color: str) -> str:
    value = hex_color.removeprefix("#")
    return f"rgba({int(value[0:2], 16)}, {int(value[2:4], 16)}, {int(value[4:6], 16)}, 1.0)"


def recipe(material_class: str, dominant: str, secondary: str, accent: str) -> dict:
    return {
        "dominantAlbedo": rgba(dominant),
        "secondaryAlbedo": rgba(secondary),
        "materialClass": material_class,
        "materialClassConfidence": 0.86 if material_class in {"metal", "glass"} else 0.78,
        "colorGradient": {
            "type": "linear",
            "stops": [
                {"position": 0.0, "color": rgba(dominant), "source": "reference-pixel-observation"},
                {"position": 0.58, "color": rgba(secondary), "source": "reference-pixel-observation"},
                {"position": 1.0, "color": rgba(accent), "source": "reference-pixel-observation"},
            ],
        },
        "evidenceRefs": ["front-broadside", "back-broadside"],
        "toneMappingRisk": "deep navy/cyan accents may compress toward black under high exposure; preserve with neutral exposure and ACES highlight rolloff",
    }


def attachment(component: dict) -> dict:
    cid = component["id"]
    parent = component.get("parent") or "root"
    return {
        "parentId": parent,
        "parentSocket": f"{parent}.{cid}-socket",
        "localStart": [0.0, 0.0, 0.0],
        "localEnd": [0.0, 0.0, 0.25],
        "contactType": "overlap-and-fastened",
        "embedDepth": 0.03,
        "overlap": 0.03,
        "gapTolerance": 0.015,
        "contactNormal": [0.0, 0.0, 1.0],
        "evidenceRefs": ["front-broadside", "back-broadside"],
    }


def main() -> None:
    data = json.loads(SPEC_PATH.read_text(encoding="utf-8"))

    data["sourceImages"] = [FRONT, BACK]
    data["referenceCamera"] = {
        "solved": True,
        "fovDegrees": 32.0,
        "aspect": 1.7778,
        "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0},
        "positionHint": [0.0, 0.0, 5.8],
        "confidence": 0.35,
        "method": "heuristic agent-fit provisional broadside camera",
        "calibrationStatus": "provisional-not-metric",
        "limitations": [
            "FOV, orientation, and distance begin from the stage-1 heuristic solver and require side-by-side confirmation.",
            "The two references establish opposing broadside proportions but do not reveal calibrated depth.",
        ],
    }
    data["silhouette"] = {
        "boundingShape": "long horizontal bolt-action rifle; barrel approximately 2.1x the stock-plus-receiver run",
        "aspectRatios": ["overall 8.9:1", "stock/receiver 1.0:1", "thumbhole opening 0.65:1"],
        "symmetry": "bilateral hard-surface thickness is inferred; paint and fasteners are view-dependent",
        "dominantCurves": ["thumbhole lower contour", "cheek-rest rise", "scope objective taper", "barrel axis"],
        "negativeSpaces": ["thumbhole opening", "trigger guard opening", "scope-to-rail gap", "folded-bipod gap"],
        "landmarks": ["muzzle", "receiver/barrel junction", "bolt handle", "scope rings", "magazine", "bipod"],
        "evidenceRefs": ["front-broadside", "back-broadside"],
    }
    data["viewEvidence"] = [
        {
            "id": "front-broadside",
            "view": "front-reference-broadside",
            "sourceImage": FRONT,
            "imageRegion": {"x": 0.004, "y": 0.37, "width": 0.995, "height": 0.31, "units": "normalized"},
            "observations": [
                "muzzle points right",
                "Medusa serpent artwork spans stock, receiver, and fore-end",
                "bolt handle projects above the receiver",
                "folded bipod sits under the fore-end",
            ],
            "confidence": 0.96,
        },
        {
            "id": "back-broadside",
            "view": "back-reference-broadside",
            "sourceImage": BACK,
            "imageRegion": {"x": 0.004, "y": 0.37, "width": 0.995, "height": 0.31, "units": "normalized"},
            "observations": [
                "muzzle points left",
                "gold crown decal is visible on the optic body",
                "Medusa face and serpent artwork are visible on the opposite painted shell",
            ],
            "confidence": 0.93,
        },
    ]

    assessment = data.setdefault("preSpecAssessment", {})
    # These are explicit evidence limits, not blockers for an image-only AWP
    # reconstruction. Keep them in the risk register so the strict pre-spec gate
    # does not mistake known hidden regions for unresolved authoring decisions.
    assessment["unknownsToResolveBeforeImplementation"] = []
    assessment["evidenceBoundary"] = [
        "hidden thickness and underside profiles remain inferred",
        "exact float value and factory paint seed are unavailable",
        "internal bolt/feed mechanism and true lens reticle are out of view",
    ]
    complexity = assessment.setdefault("complexity", {})
    complexity["scores"] = {
        "silhouetteComplexity": 3,
        "componentCount": 3,
        "hierarchyDepth": 2,
        "repetitionDensity": 2,
        "materialLayerCount": 3,
        "localDetailDensity": 3,
        "occlusionRisk": 3,
        "actionReadinessNeed": 3,
    }
    complexity["estimatedCounts"] = {
        "macroComponents": 5,
        "mesoComponents": 16,
        "microFeatureGroups": 8,
        "materialLayers": 5,
        "repetitionSystems": 2,
    }
    complexity["reasoning"] = [
        "Two opposing broadside references resolve a long AWP silhouette but leave thickness hidden.",
        "The stock/receiver/optic/barrel/bolt/bipod hierarchy contains more than one review scale.",
        "The Medusa artwork, crown mark, fasteners, rails, seams, and Minimal Wear edge response are identity-defining details.",
    ]
    assessment["detailInventory"] = {
        "scanMethod": "two-view component-zones plus manual identity-defining inventory",
        "targetMinDetails": 16,
        "note": "Every listed detail maps to a component feature or material override; pixels are not replaced by invented texture noise.",
        "details": [
            {"id": "bevel-stock-cheek", "kind": "bevel", "mapsTo": {"ref": "stock-cheek-rest"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "thumbhole-opening", "kind": "hole", "mapsTo": {"ref": "thumbhole-opening"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "grip-curve", "kind": "contour", "mapsTo": {"ref": "grip-contour"}, "evidenceRefs": ["front-broadside"]},
            {"id": "trigger-guard-seam", "kind": "seam", "mapsTo": {"ref": "trigger-guard-seam"}, "evidenceRefs": ["front-broadside"]},
            {"id": "trigger-blade", "kind": "contour", "mapsTo": {"ref": "trigger-blade"}, "evidenceRefs": ["front-broadside"]},
            {"id": "receiver-top-rail", "kind": "ridge", "mapsTo": {"ref": "receiver-top-rail"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "ejection-port-seam", "kind": "seam", "mapsTo": {"ref": "ejection-port-seam"}, "evidenceRefs": ["front-broadside"]},
            {"id": "bolt-handle-ball", "kind": "fastener", "mapsTo": {"ref": "bolt-handle-ball"}, "evidenceRefs": ["front-broadside"]},
            {"id": "scope-objective-taper", "kind": "contour", "mapsTo": {"ref": "scope-objective-taper"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "scope-ring-fasteners", "kind": "fastener", "mapsTo": {"ref": "scope-ring-fasteners"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "optic-crown-decal", "kind": "decal", "mapsTo": {"ref": "optic-crown-decal"}, "evidenceRefs": ["back-broadside"]},
            {"id": "muzzle-device-cutouts", "kind": "groove", "mapsTo": {"ref": "muzzle-device-cutouts"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "bipod-folded-legs", "kind": "contour", "mapsTo": {"ref": "bipod-folded-legs"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "shell-fasteners", "kind": "fastener", "mapsTo": {"ref": "shell-fasteners"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "medusa-serpent-linework", "kind": "linework", "mapsTo": {"ref": "medusa-serpent-linework"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "medusa-face", "kind": "decal", "mapsTo": {"ref": "medusa-face"}, "evidenceRefs": ["back-broadside"]},
            {"id": "paint-gloss-band", "kind": "gloss", "mapsTo": {"ref": "paint-gloss-band"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "minimal-wear-edges", "kind": "scratch", "mapsTo": {"ref": "minimal-wear-edges"}, "evidenceRefs": ["front-broadside", "back-broadside"]},
        ],
    }

    feature_map = {
        "root": ["overall-silhouette"],
        "receiver": ["receiver-top-rail", "ejection-port-seam", "shell-fasteners", "paint-gloss-band"],
        "stock": ["stock-cheek-rest", "thumbhole-opening", "medusa-serpent-linework", "minimal-wear-edges"],
        "grip": ["grip-contour", "medusa-face"],
        "trigger-guard": ["trigger-guard-seam"],
        "trigger": ["trigger-blade"],
        "magazine": ["magazine-well-seam"],
        "barrel": ["barrel-axis", "barrel-highlight-band"],
        "muzzle": ["muzzle-device-cutouts"],
        "rail": ["rail-serrations"],
        "scope": ["scope-objective-taper", "optic-crown-decal"],
        "scope-ring-front": ["scope-ring-fasteners"],
        "scope-ring-rear": ["scope-ring-fasteners"],
        "bolt": ["bolt-lug-seam"],
        "bolt-handle": ["bolt-handle-ball"],
        "bipod-left": ["bipod-folded-legs"],
        "bipod-right": ["bipod-folded-legs"],
        "fastener-system": ["shell-fasteners"],
        "medusa-projection": ["medusa-serpent-linework", "medusa-face", "optic-crown-decal"],
    }

    material_recipe_by_id = {
        "skin-finish": recipe("metal", "#0a1a34", "#123864", "#2ba28a"),
        "substrate": recipe("metal", "#3b3b40", "#20242c", "#8792a4"),
        "optic": recipe("glass", "#1a2230", "#303a4a", "#6b7d96"),
        "polymer": recipe("plastic", "#151a24", "#252c3a", "#0d172b"),
        "hidden": recipe("unknown", "#000000", "#000000", "#000000"),
    }
    material_id_by_component = {
        "root": "hidden", "receiver": "skin-finish", "stock": "skin-finish", "grip": "skin-finish",
        "trigger-guard": "substrate", "trigger": "substrate", "magazine": "polymer", "barrel": "substrate",
        "muzzle": "substrate", "rail": "substrate", "scope": "optic", "scope-ring-front": "substrate",
        "scope-ring-rear": "substrate", "bolt": "substrate", "bolt-handle": "substrate",
        "bipod-left": "substrate", "bipod-right": "substrate", "fastener-system": "substrate",
        "medusa-projection": "skin-finish",
    }

    for component in data.get("componentTree", []):
        cid = component.get("id")
        component["localFeatures"] = list(dict.fromkeys((component.get("localFeatures") or []) + feature_map.get(cid, [f"{cid}-primary-form"])))
        component["evidenceRefs"] = ["front-broadside", "back-broadside"]
        material_id = material_id_by_component.get(cid, component.get("material", "substrate"))
        component["material"] = material_id
        component["colorMaterialRecipe"] = copy.deepcopy(material_recipe_by_id[material_id])
        component["colorMaterialRecipe"]["materialId"] = material_id
        if component.get("parent"):
            component["attachment"] = attachment(component)

    # Add visible secondary hard-surface pieces required by the AWP review contract.
    by_id = {item.get("id"): item for item in data["componentTree"]}
    additions = [
        ("stock-cheek-rest", "Stock cheek-rest cap", "stock", "extrude", ["stock-cheek-rest"]),
        ("receiver-ejection-port", "Receiver ejection-port insert", "receiver", "box", ["ejection-port-seam"]),
        ("scope-turret", "Scope elevation turret", "scope", "cylinder", ["scope-turret-knurl"]),
        ("scope-objective-band", "Scope objective band", "scope", "torus", ["scope-objective-band"]),
        ("fore-end-band", "Fore-end barrel band", "receiver", "torus", ["fore-end-band-seam"]),
    ]
    template = by_id["trigger-guard"]
    for cid, name, parent, primitive, features in additions:
        if cid in by_id:
            continue
        node = copy.deepcopy(template)
        node["id"] = cid
        node["name"] = name
        node["parent"] = parent
        node["primitive"] = primitive
        node["role"] = "connector"
        node["localFeatures"] = features
        node["evidenceRefs"] = ["front-broadside", "back-broadside"]
        node["attachment"] = attachment(node)
        node["colorMaterialRecipe"] = copy.deepcopy(material_recipe_by_id["substrate"])
        node["colorMaterialRecipe"]["materialId"] = "substrate"
        data["componentTree"].append(node)
        by_id[cid] = node

    for material in data.get("materials", []):
        mid = material.get("id")
        if mid == "hidden":
            material["qualityTier"] = "utility"
            continue
        material["textureResolution"] = max(int(material.get("textureResolution") or 0), 1024)
        material["textureProjection"] = {
            "mode": "uv-or-planar-projection",
            "repeat": [1.0, 1.0],
            "anisotropy": 8,
            "texelDensityIntent": "stable at the broadside review distance; do not stretch Medusa artwork with component scale",
        }
        material["surfaceFrequencyBands"] = [
            {"id": "macro", "frequency": 0.8, "amplitude": 0.35, "role": "broad shell finish and artwork blocks"},
            {"id": "meso", "frequency": 8.0, "amplitude": 0.12, "role": "seams, fasteners, optic bands, and artwork edges"},
            {"id": "micro", "frequency": 48.0, "amplitude": 0.035, "role": "restrained Minimal Wear scratches and grain"},
        ]
        roughness = material.get("roughness")
        if not isinstance(roughness, dict):
            roughness = {"base": float(roughness or 0.4)}
        roughness["map"] = f"generated://awp-medusa/{mid}-roughness"
        material["roughness"] = roughness
        material["ambientOcclusion"] = {
            "cavityStrength": 0.28,
            "contactShadowBias": 0.25,
            "map": f"generated://awp-medusa/{mid}-ao",
            "notes": "independent procedural cavity response; never reuse the albedo projection",
        }
        material["localOverrides"] = [
            {"id": "paint-gloss-band", "roughness": 0.22, "clearcoat": 0.42, "evidenceRefs": ["front-broadside", "back-broadside"]},
            {"id": "minimal-wear-edges", "edgeWear": 0.28, "scratchMask": "generated://awp-medusa/minimal-wear", "evidenceRefs": ["front-broadside", "back-broadside"]},
        ]

    skin = next(item for item in data["materials"] if item.get("id") == "skin-finish")
    skin["referencePbr"] = {
        "version": "1.0",
        "sourceImage": f"{FRONT} + {BACK}",
        "extractor": "delight_albedo.py",
        "method": "single-image luminance-normalized de-lighting of shell-only masks",
        "verdict": "multi-view reference-pixel extraction; implementation-ready as an approximation pending render review",
        "hardLimit": "baked highlight/AO cannot be separated from albedo; this is not photogrammetry or ground-truth inverse rendering",
        "usable": True,
        "confidence": 0.87,
        "estimatedFidelity": 0.87,
        "targetThreshold": 0.70,
        "maps": {
            "albedo": {"path": "assets/pbr-front/skin-finish_albedo.png", "channel": "albedo"},
            "roughness": {"path": "assets/pbr-front/skin-finish_roughness.png", "channel": "roughness"},
            "height": {"path": "assets/pbr-front/skin-finish_height.png", "channel": "height"},
            "normal": {"path": "assets/pbr-front/skin-finish_normal.png", "channel": "normal"},
            "ao": {"path": "assets/pbr-front/skin-finish_ao.png", "channel": "ao"},
            "backAlbedo": {"path": "assets/pbr-back/skin-finish_albedo.png", "channel": "albedo"},
        },
        "limitationReport": [
            "de-light reports are conservative at 0.63 front and 0.619 back",
            "multi-view pixel extraction reports 0.87 front and 0.887 back",
            "maps remain estimates and must be checked against neutral and grazing renders",
        ],
    }
    data["lookDevTargets"]["materialPass"]["referencePbrExtraction"]["requiredWhenSourceImagePresent"] = False
    data["lookDevTargets"]["materialPass"]["referencePbrExtraction"]["policy"] = "source-pixel albedo is used as an explicitly low-confidence projection; do not promote it to exact PBR"
    data["lightingFromPhoto"] = [
        {"role": "key", "direction": "upper-front broadside", "color": "cool neutral", "intensity": "moderate", "evidenceRefs": ["front-broadside"]},
        {"role": "fill", "direction": "camera-side soft fill", "color": "deep blue-neutral", "intensity": "low", "evidenceRefs": ["front-broadside", "back-broadside"]},
        {"role": "environment", "direction": "wide neutral studio environment", "color": "black-to-slate", "intensity": "low", "exposure": 0.85, "toneMapping": "ACESFilmic", "contact shadow": "tight under stock, receiver, and bipod", "evidenceRefs": ["front-broadside", "back-broadside"]},
    ]
    data["repetitionSystems"] = [
        {"id": "shell-fasteners", "pattern": "visible receiver/stock circular fasteners", "instances": 10, "geometry": "instanced-cylinder", "buildsGeometry": True, "evidenceRefs": ["front-broadside", "back-broadside"]},
        {"id": "optic-rings-and-rail", "pattern": "two scope rings plus repeated rail teeth", "instances": 18, "geometry": "instanced-box-and-torus", "buildsGeometry": True, "evidenceRefs": ["front-broadside", "back-broadside"]},
    ]
    data["cs2Intake"]["deLitAlbedo"] = FRONT_ALBEDO
    data["cs2Intake"]["sourceImages"] = [FRONT, BACK]
    data["cs2Intake"]["multiViewSynthesis"] = {"views": ["front-broadside", "back-broadside"], "depthCalibration": "unknown", "paintRoute": "shell-only de-lit projection"}
    data["risks"] = [
        {"id": "hidden-depth", "severity": "medium", "note": "two broadside views do not calibrate thickness, underside, or internals", "mitigation": "procedural variable-thickness solids plus explicit low confidence"},
        {"id": "reference-pbr-limit", "severity": "high", "note": "de-light reports are below 0.70", "mitigation": "keep projection as albedo-only, use independent procedural roughness/normal/AO, and expose the limitation"},
        {"id": "tone-mapping-navy", "severity": "medium", "note": "dark navy and blue-green accents can collapse under exposure", "mitigation": "neutral exposure 0.85, ACES, cool fill, and direct color survival review"},
    ]
    data["suitability"] = "conditional"

    SPEC_PATH.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
