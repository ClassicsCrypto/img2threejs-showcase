import { evaluateResponse } from "../drivers/index.js";
export function muscleWeight(driver, jointAngleRadians) {
    return Math.max(0, Math.min(1, evaluateResponse(driver.response, jointAngleRadians)));
}
//# sourceMappingURL=index.js.map