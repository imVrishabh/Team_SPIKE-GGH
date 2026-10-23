(function (root) {
  const COLOR_NAMES = [
    'black',
    'white',
    'grey',
    'brown',
    'red',
    'orange',
    'yellow',
    'green',
    'cyan',
    'blue',
    'purple',
    'pink',
  ];

  function rgbToHsv(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;

    if (delta !== 0) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }

    return { hue, saturation: max === 0 ? 0 : delta / max, value: max };
  }

  function classifyRgb(red, green, blue) {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const hsv = rgbToHsv(red, green, blue);

    if (max <= 45) return 'black';
    if (min >= 222 && max - min <= 42) return 'white';
    if (hsv.saturation <= 0.17) return 'grey';
    if (hsv.hue < 10 || hsv.hue >= 350) return 'red';
    if (hsv.hue < 22) return hsv.value < 0.62 ? 'brown' : 'orange';
    if (hsv.hue < 45) return hsv.value < 0.58 ? 'brown' : 'orange';
    if (hsv.hue < 70) return 'yellow';
    if (hsv.hue < 165) return 'green';
    if (hsv.hue < 195) return 'cyan';
    if (hsv.hue < 255) return 'blue';
    if (hsv.hue < 315) return 'purple';
    if (hsv.hue < 350) return hsv.value < 0.58 ? 'purple' : 'pink';
    return 'red';
  }

  function toHex(red, green, blue) {
    return `#${[red, green, blue]
      .map((value) => Math.round(value).toString(16).padStart(2, '0'))
      .join('')}`;
  }

  function detectDominantColour(imageData, options = {}) {
    const { data, width, height } = imageData;
    if (!data || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new TypeError('A valid image-data buffer and dimensions are required.');
    }

    const regionFraction = options.regionFraction || 0.5;
    const sampleStep = options.sampleStep || 2;
    const regionWidth = Math.max(1, Math.floor(width * regionFraction));
    const regionHeight = Math.max(1, Math.floor(height * regionFraction));
    const left = Math.floor((width - regionWidth) / 2);
    const top = Math.floor((height - regionHeight) / 2);
    const counts = Object.fromEntries(COLOR_NAMES.map((name) => [name, 0]));
    const sums = Object.fromEntries(COLOR_NAMES.map((name) => [name, [0, 0, 0]]));
    let chromaticSamples = 0;
    let neutralSamples = 0;
    let allSamples = 0;

    for (let y = top; y < top + regionHeight; y += sampleStep) {
      for (let x = left; x < left + regionWidth; x += sampleStep) {
        const offset = (y * width + x) * 4;
        const alpha = data[offset + 3];
        if (alpha < 128) continue;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const category = classifyRgb(red, green, blue);
        allSamples += 1;

        if (max <= 45 || (min >= 222 && max - min <= 42) || max - min <= max * 0.17) {
          neutralSamples += 1;
          counts[category] += 1;
          sums[category][0] += red;
          sums[category][1] += green;
          sums[category][2] += blue;
          continue;
        }

        // Very dark and near-white pixels are excluded from chromatic voting.
        if (max < 40 || min > 244) continue;
        chromaticSamples += 1;
        counts[category] += 1;
        sums[category][0] += red;
        sums[category][1] += green;
        sums[category][2] += blue;
      }
    }

    if (allSamples === 0) throw new Error('No visible pixels were available in the camera frame.');
    const chromaticShare = chromaticSamples / allSamples;
    const useChromaticVotes = chromaticSamples > 0 && chromaticShare >= 0.12;
    const eligible = COLOR_NAMES.filter((name) => (
      useChromaticVotes
        ? !['black', 'white', 'grey'].includes(name)
        : ['black', 'white', 'grey'].includes(name)
    ));
    const totalVotes = useChromaticVotes ? chromaticSamples : neutralSamples;

    if (totalVotes === 0) {
      return {
        name: 'uncertain',
        rgb: [128, 128, 128],
        hex: '#808080',
        confidence: 0,
        sampleCount: 0,
      };
    }

    const winner = eligible.reduce((best, name) => counts[name] > counts[best] ? name : best, eligible[0]);
    const rgb = sums[winner].map((value) => Math.round(value / counts[winner]));
    return {
      name: winner,
      rgb,
      hex: toHex(rgb[0], rgb[1], rgb[2]),
      confidence: counts[winner] / totalVotes,
      sampleCount: totalVotes,
    };
  }

  const api = { classifyRgb, detectDominantColour, rgbToHsv, toHex };
  root.VivaColorDetection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
