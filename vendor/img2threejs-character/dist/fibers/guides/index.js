export function guideLength(guide) {
    let length = 0;
    for (let index = 1; index < guide.points.length; index += 1) {
        const a = guide.points[index - 1];
        const b = guide.points[index];
        length += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    return length;
}
export function validateGuides(guides) {
    return guides.flatMap((guide) => guide.points.length < 2 || guideLength(guide) <= 0 ? [`${guide.id} is not a non-zero guide`] : []);
}
//# sourceMappingURL=index.js.map