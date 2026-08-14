export interface Rng {
    next(): number;
    normal(): number;
    logNormal(median: number, sigma: number): number;
    exponential(mean: number): number;
    bernoulli(probability: number): boolean;
}

export function hashString(input: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function splitMix32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x9e3779b9) >>> 0;
        let z = state;
        z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
        z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
        return (z ^ (z >>> 15)) >>> 0;
    };
}

function rotateLeft(value: number, shift: number): number {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

export function createRng(seed: number): Rng {
    const seeder = splitMix32(seed === 0 ? 0x9e3779b9 : seed);
    let s0 = seeder();
    let s1 = seeder();
    let s2 = seeder();
    let s3 = seeder();

    const nextUint32 = (): number => {
        const result = Math.imul(rotateLeft(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
        const t = (s1 << 9) >>> 0;

        s2 = (s2 ^ s0) >>> 0;
        s3 = (s3 ^ s1) >>> 0;
        s1 = (s1 ^ s2) >>> 0;
        s0 = (s0 ^ s3) >>> 0;
        s2 = (s2 ^ t) >>> 0;
        s3 = rotateLeft(s3, 11);

        return result;
    };

    let spareNormal: number | null = null;

    const next = (): number => nextUint32() / 4294967296;

    const normal = (): number => {
        if (spareNormal !== null) {
            const value = spareNormal;
            spareNormal = null;
            return value;
        }

        let u = 0;
        let v = 0;
        let squared = 0;

        do {
            u = next() * 2 - 1;
            v = next() * 2 - 1;
            squared = u * u + v * v;
        } while (squared >= 1 || squared === 0);

        const factor = Math.sqrt((-2 * Math.log(squared)) / squared);
        spareNormal = v * factor;
        return u * factor;
    };

    return {
        next,
        normal,
        logNormal: (median, sigma) => median * Math.exp(sigma * normal()),
        exponential: (mean) => -mean * Math.log(1 - next()),
        bernoulli: (probability) => next() < probability,
    };
}
