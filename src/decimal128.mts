/**
 * decimal128.js -- Decimal128 implementation in JavaScript
 *
 * The purpose of this module is to provide a userland implementation of
 * IEEE 758 Decimal128, which are exact decimal floating point numbers fit into
 * 128 bits. This library provides basic arithmetic operations (addition, multiplication).
 * It's main purpose is to help gather data and experience about using Decimal128
 * in JavaScript programs. Speed is not a concern; the main goal is to simply
 * make Decimal128 values available in some form in JavaScript. In the future,
 * JavaScript may get exact decimal numbers as a built-in data type, which will
 * surely be much faster than what this library can provide.
 *
 * @author Jesse Alama <jesse@igalia.com>
 */

import {
    countSignificantDigits,
    Digit,
    ROUNDING_MODE_HALF_EVEN,
    ROUNDING_MODE_HALF_EXPAND,
    RoundingMode,
} from "./common.mjs";
import { Rational } from "./rational.mjs";
import { DigitString } from "./digitString.mjs";

const EXPONENT_MIN = -6143;
const EXPONENT_MAX = 6144;
const MAX_SIGNIFICANT_DIGITS = 34;

const bigZero = BigInt(0);

/**
 * Return the significand of a digit string, assumed to be normalized.
 * The returned value is a digit string that has no decimal point, even if the original
 * digit string had one.
 *
 * @param s
 *
 * @example significand("123.456") // => "123456"
 * @example significand("0.000123") // => "123"
 */
function significand(s: string): string {
    if (s.match(/^-/)) {
        return significand(s.substring(1));
    } else if (s.match(/^0[.]/)) {
        return significand(s.substring(2));
    } else if (s.match(/[.]/)) {
        return significand(s.replace(/[.]/, ""));
    } else if (s.match(/^0+/)) {
        return significand(s.replace(/^0+/, ""));
    } else if (s.match(/0+$/)) {
        return significand(s.replace(/0+$/, ""));
    } else {
        return s;
    }
}
/**
 * Return the exponent of a digit string, assumed to be normalized. It is the number of digits
 * to the left or right that the significand needs to be shifted to recover the original (normalized)
 * digit string.
 *
 * @param s string of digits (assumed to be normalized)
 */
function exponent(s: string): number {
    if (s.match(/^-/)) {
        return exponent(s.substring(1));
    } else if (s.match(/[.]/)) {
        let rhs = s.split(".")[1];
        return 0 - rhs.length;
    } else if (s === "0") {
        return 0;
    } else {
        let m = s.match(/0+$/);
        if (m) {
            return m[0].length;
        } else {
            return 0;
        }
    }
}

interface Decimal128Constructor {
    isNaN: boolean;
    isFinite: boolean;
    digits: DigitString;
    isNegative: boolean;
}

function isInteger(x: Decimal128Constructor): boolean {
    return !x.isNaN && x.isFinite && x.digits.exponent() >= bigZero;
}

function validateConstructorData(x: Decimal128Constructor): void {
    if (x.isNaN) {
        return; // no further validation needed
    }

    let numSigDigits = x.digits.countSignificantDigits();
    let exp = x.digits.exponent();

    if (isInteger(x) && numSigDigits > MAX_SIGNIFICANT_DIGITS) {
        throw new RangeError("Integer too large");
    }

    if (exp > EXPONENT_MAX) {
        throw new RangeError(`Exponent too big (${exponent})`);
    }

    if (exp < EXPONENT_MIN) {
        throw new RangeError(`Exponent too small (${exponent})`);
    }
}

function handleNan(s: string): Decimal128Constructor {
    return {
        digits: new DigitString("", ""),
        isNegative: !!s.match(/^-/),
        isNaN: true,
        isFinite: false,
    };
}

function convertExponentialStringToDecimalString(s: string): string {
    let [lhs, rhs] = s.split(/[eE]/);
    let exp = parseInt(rhs);
    if (exp < 0) {
        return "0." + "0".repeat(Math.abs(exp) - 1) + lhs.replace(/[.]/, "");
    }

    if (0 === exp) {
        return lhs;
    }

    if (exp >= lhs.length) {
        return lhs + "0".repeat(exp - lhs.length);
    }

    return lhs.substring(0, exp) + "." + lhs.substring(exp);
}

function handleExponentialNotation(s: string): Decimal128Constructor {
    return handleDecimalNotation(convertExponentialStringToDecimalString(s));
}

function handleDecimalNotation(s: string): Decimal128Constructor {
    let withoutUnderscores = s.replace(/_/g, "");
    let isNegative = !!s.match(/^-/);

    if (isNegative) {
        withoutUnderscores = withoutUnderscores.substring(1);
    }

    let sg = significand(withoutUnderscores);
    let exp = exponent(withoutUnderscores);
    let numSigDigits = countSignificantDigits(withoutUnderscores);
    let isInteger = exp >= 0;

    let [lhs, rhs] = withoutUnderscores.split(".");

    let digits = new DigitString(lhs, typeof rhs === "undefined" ? "" : rhs);

    if (!isInteger && numSigDigits > MAX_SIGNIFICANT_DIGITS) {
        let lastDigit = parseInt(sg.charAt(MAX_SIGNIFICANT_DIGITS)) as Digit;
        digits = digits.round(lastDigit, ROUNDING_MODE_HALF_EVEN);
    }

    return {
        digits: digits,
        isNaN: false,
        isFinite: true,
        isNegative: isNegative,
    };
}

function handleInfinity(s: string): Decimal128Constructor {
    return {
        digits: new DigitString("", ""),
        isNegative: !!s.match(/^-/),
        isNaN: false,
        isFinite: false,
    };
}

const ROUNDING_MODE_DEFAULT = ROUNDING_MODE_HALF_EXPAND;

export class Decimal128 {
    public readonly isNaN: boolean;
    public readonly isFinite: boolean;
    public readonly digits: DigitString;
    public readonly isNegative: boolean;
    private readonly digitStrRegExp =
        /^-?[0-9]+(?:_?[0-9]+)*(?:[.][0-9](_?[0-9]+)*)?$/;
    private readonly exponentRegExp = /^-?[1-9][0-9]*[eE][-+]?[1-9][0-9]*$/;
    private readonly nanRegExp = /^-?nan$/i;
    private readonly infRegExp = /^-?inf(inity)?$/i;

    constructor(n: string) {
        let data = undefined;

        if (n.match(this.nanRegExp)) {
            data = handleNan(n);
        } else if (n.match(this.exponentRegExp)) {
            data = handleExponentialNotation(n);
        } else if (n.match(this.digitStrRegExp)) {
            data = handleDecimalNotation(n);
        } else if (n.match(this.infRegExp)) {
            data = handleInfinity(n);
        } else {
            throw new SyntaxError(`Illegal number format "${n}"`);
        }

        validateConstructorData(data);

        this.isNaN = data.isNaN;
        this.isFinite = data.isFinite;
        this.digits = data.digits;
        this.isNegative = data.isNegative;
    }

    private toRational(): Rational {
        return this.digits.toRational();
    }

    /**
     * Returns a digit string representing this Decimal128.
     */
    toString(): string {
        if (this.isNaN) {
            return "NaN";
        }

        if (!this.isFinite) {
            return (this.isNegative ? "-" : "") + "Infinity";
        }

        return this.digits.toString();
    }

    /**
     * Returns an exponential string representing this Decimal128.
     *
     */
    toExponentialString(): string {
        let significand = this.digits.significand().join("");
        return (
            (this.isNegative ? "-" : "") +
            (significand === "" ? "0" : significand) +
            "E" +
            this.digits.exponent()
        );
    }

    /**
     * Is this Decimal128 actually an integer? That is: is there nothing after the decimal point?
     */
    isInteger(): boolean {
        return !this.isNaN && this.isFinite && this.digits.exponent() >= 0;
    }

    /**
     * Return the absolute value of this Decimal128 value.
     *
     */
    abs(): Decimal128 {
        if (this.isNegative) {
            return new Decimal128(this.toString().substring(1));
        }

        return this;
    }

    /**
     * Return a digit string where the digits of this number are cut off after
     * a certain number of digits. Rounding may be performed, in case we always round up.
     *
     * @param n
     */
    toDecimalPlaces(n: number): Decimal128 {
        if (!Number.isInteger(n)) {
            throw new TypeError("Argument must be an integer");
        }

        if (n < 0) {
            throw new RangeError("Argument must be non-negative");
        }

        let s = this.toString();
        let [lhs, rhs] = s.split(".");

        if (undefined === rhs || 0 === n) {
            return new Decimal128(lhs);
        }

        if (rhs.length <= n) {
            return new Decimal128(s);
        }

        let penultimateDigit = parseInt(rhs.charAt(n - 1));

        return new Decimal128(
            lhs + "." + rhs.substring(0, n - 1) + `${penultimateDigit + 1}`
        );
    }

    /**
     * Return the ceiling of this number. That is: the smallest integer greater than or equal to this number.
     */
    ceil(): Decimal128 {
        if (this.isInteger()) {
            return this;
        }

        if (this.isNegative) {
            return this.truncate();
        }

        return this.add(new Decimal128("1")).truncate();
    }

    /**
     * Return the floor of this number. That is: the largest integer less than or equal to this number.
     *
     */
    floor(): Decimal128 {
        return this.truncate();
    }

    /**
     * Compare two values. Return
     *
     * + -1 if this value is strictly less than the other,
     * + 0 if they are equal, and
     * + 1 otherwise.
     *
     * @param x
     */
    cmp(x: Decimal128): -1 | 0 | 1 | undefined {
        if (this.isNaN || x.isNaN) {
            return undefined;
        }

        if (!this.isFinite) {
            if (!x.isFinite) {
                if (this.isNegative === x.isNegative) {
                    return 0;
                }

                return this.isNegative ? -1 : 1;
            }

            if (this.isNegative) {
                return -1;
            }

            return 1;
        }

        if (!x.isFinite) {
            return x.isNegative ? 1 : -1;
        }

        return this.toRational().cmp(x.toRational());
    }

    /**
     * Truncate the decimal part of this number (if any), returning an integer.
     *
     * @return {Decimal128} An integer (as a Decimal128 value).
     */
    truncate(): Decimal128 {
        if (this.isNaN) {
            return this;
        }

        let [lhs] = this.toString().split(".");
        return new Decimal128(lhs);
    }

    /**
     * Add this Decimal128 value to one or more Decimal128 values.
     *
     * @param x
     */
    add(x: Decimal128): Decimal128 {
        if (this.isNaN || x.isNaN) {
            return new Decimal128("NaN");
        }

        if (!this.isFinite) {
            if (!x.isFinite) {
                if (this.isNegative === x.isNegative) {
                    return this;
                }

                return new Decimal128("NaN");
            }

            return this;
        }

        if (!x.isFinite) {
            return x;
        }
        let resultRat = Rational.add(this.toRational(), x.toRational());
        return new Decimal128(
            resultRat.toDecimalPlaces(MAX_SIGNIFICANT_DIGITS + 1)
        );
    }

    /**
     * Subtract another Decimal128 value from one or more Decimal128 values.
     *
     * @param x
     */
    subtract(x: Decimal128): Decimal128 {
        if (this.isNaN || x.isNaN) {
            return new Decimal128("NaN");
        }

        if (!this.isFinite) {
            if (!x.isFinite) {
                if (this.isNegative === x.isNegative) {
                    return new Decimal128("NaN");
                }

                return this;
            }

            return this;
        }

        if (!x.isFinite) {
            return x.negate();
        }

        return new Decimal128(
            Rational.subtract(
                this.toRational(),
                x.toRational()
            ).toDecimalPlaces(MAX_SIGNIFICANT_DIGITS + 1)
        );
    }

    /**
     * Multiply this Decimal128 value by an array of other Decimal128 values.
     *
     * If no arguments are given, return this value.
     *
     * @param x
     */
    multiply(x: Decimal128): Decimal128 {
        if (this.isNaN || x.isNaN) {
            return new Decimal128("NaN");
        }

        if (!this.isFinite) {
            if (x.isZero()) {
                return new Decimal128("NaN");
            }

            if (this.isNegative === x.isNegative) {
                return new Decimal128("Infinity");
            }

            return new Decimal128("-Infinity");
        }

        if (!x.isFinite) {
            if (this.isZero()) {
                return new Decimal128("NaN");
            }

            if (this.isNegative === x.isNegative) {
                return new Decimal128("Infinity");
            }

            return new Decimal128("-Infinity");
        }

        let resultRat = Rational.multiply(this.toRational(), x.toRational());
        return new Decimal128(
            resultRat.toDecimalPlaces(MAX_SIGNIFICANT_DIGITS + 1)
        );
    }

    private isZero(): boolean {
        return !this.isNaN && this.isFinite && this.digits.isInteger();
    }

    /**
     * Divide this Decimal128 value by an array of other Decimal128 values.
     *
     * Association is to the left: 1/2/3 is (1/2)/3
     *
     * If only one argument is given, just return the first argument.
     *
     * @param x
     */
    divide(x: Decimal128): Decimal128 {
        if (this.isNaN || x.isNaN) {
            return new Decimal128("NaN");
        }

        if (x.isZero()) {
            return new Decimal128("NaN");
        }

        if (!this.isFinite) {
            if (!x.isFinite) {
                return new Decimal128("NaN");
            }

            if (this.isNegative === x.isNegative) {
                return new Decimal128("Infinity");
            }

            if (this.isNegative) {
                return this;
            }

            return new Decimal128("-Infinity");
        }

        if (!x.isFinite) {
            if (this.isNegative === x.isNegative) {
                return new Decimal128("0");
            }

            return new Decimal128("-0");
        }

        return new Decimal128(
            Rational.divide(this.toRational(), x.toRational()).toDecimalPlaces(
                MAX_SIGNIFICANT_DIGITS + 1
            )
        );
    }

    /**
     *
     * @param numDecimalDigits
     * @param {RoundingMode} mode (default: ROUNDING_MODE_DEFAULT)
     */
    round(
        numDecimalDigits: number = 0,
        mode: RoundingMode = ROUNDING_MODE_DEFAULT
    ): Decimal128 {
        if (!Number.isSafeInteger(numDecimalDigits + 1)) {
            throw new TypeError(
                "Argument for number of decimal digits must be a safe integer"
            );
        }

        if (numDecimalDigits < 0) {
            throw new RangeError(
                "Argument for number of decimal digits must be non-negative"
            );
        }

        if (this.isNaN) {
            return this;
        }

        if (!this.isFinite) {
            return this;
        }

        if (this.digits.rhs.length < numDecimalDigits) {
            return this;
        }

        let decidingDigit = this.digits.rhs[numDecimalDigits];
        let rounded = this.digits.round(decidingDigit, mode);

        return new Decimal128(rounded.toString());
    }

    negate(): Decimal128 {
        let s = this.toString();

        if (s.match(/^-/)) {
            return new Decimal128(s.substring(1));
        }

        return new Decimal128("-" + s);
    }

    /**
     * Return the remainder of this Decimal128 value divided by another Decimal128 value.
     *
     * @param d
     * @throws RangeError If argument is zero
     */
    remainder(d: Decimal128): Decimal128 {
        if (this.isNaN || d.isNaN) {
            return new Decimal128("NaN");
        }

        if (this.isNegative) {
            return this.negate().remainder(d).negate();
        }

        if (d.isNegative) {
            return this.remainder(d.negate());
        }

        if (!this.isFinite) {
            return new Decimal128("NaN");
        }

        if (!d.isFinite) {
            return this;
        }

        let q = this.divide(d).round();
        return this.subtract(d.multiply(q)).abs();
    }

    reciprocal(): Decimal128 {
        return new Decimal128("1").divide(this);
    }

    pow(n: Decimal128): Decimal128 {
        if (!n.isInteger()) {
            throw new TypeError("Exponent must be an integer");
        }

        if (n.isNegative) {
            return this.pow(n.negate()).reciprocal();
        }

        let one = new Decimal128("1");
        let i = new Decimal128("0");
        let result: Decimal128 = one;
        while (i.cmp(n) === -1) {
            result = result.multiply(this);
            i = i.add(one);
        }

        return result;
    }
}
