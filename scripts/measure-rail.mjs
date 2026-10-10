// Finds the brass rail rows in chosen pixel columns of a plate, to place the animated ball.
import sharp from "sharp";

const [file, ...cols] = process.argv.slice(2);
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => {
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const isBrass = ([r, g, b]) => r - b > 55 && r > 120 && r < 215 && g > 90;

for (const x of cols.map(Number)) {
  const runs = [];
  let start = null;
  for (let y = 0; y < info.height; y++) {
    const hit = isBrass(px(x, y));
    if (hit && start === null) start = y;
    if (!hit && start !== null) {
      if (y - start >= 2) runs.push([start, y - 1]);
      start = null;
    }
  }
  console.log(x, JSON.stringify(runs.slice(0, 6)));
}
console.log("size", info.width, info.height);
