import {
    Digit,
    DigitOrTen,
    ROUNDING_MODE_CEILING,
    ROUNDING_MODE_EXPAND,
    ROUNDING_MODE_FLOOR,
    ROUNDING_MODE_HALF_CEILING,
    ROUNDING_MODE_HALF_EVEN,
    ROUNDING_MODE_HALF_EXPAND,
    ROUNDING_MODE_HALF_FLOOR,
    ROUNDING_MODE_HALF_TRUNCATE,
    ROUNDING_MODE_TRUNCATE,
    RoundingMode,
} from "./common.mjs";
import { Rational } from "./rational.mjs";

function integerCharToDigit(c: string): Digit {
    switch (c) {
        case "0":
            return 0;
        case "1":
            return 1;
        case "2":
            return 2;
        case "3":
            return 3;
        case "4":
            return 4;
        case "5":
            return 5;
        case "6":
            return 6;
        case "7":
            return 7;
        case "8":
            return 8;
        case "9":
            return 9;
        default:
            throw new Error(`Not a digit: ${c}`);
    }
}

function explodeDigits(s: string): Array<Digit> {
    return s.split("").map(integerCharToDigit);
}

function propagateCarryFromRight(s: string): string {
    let [left, right] = s.split(/[.]/);

    if (undefined === right) {
        let lastDigit = parseInt(left.charAt(left.length - 1));
        if (lastDigit === 9) {
            if (1 === left.length) {
                return "10";
            }

            return (
                propagateCarryFromRight(left.substring(0, left.length - 1)) +
                "0"
            );
        }
        return left.substring(0, left.length - 1) + `${lastDigit + 1}`;
    }

    let len = right.length;

    if (1 === len) {
        return propagateCarryFromRight(left) + ".0";
    } else {
        let finalDigit = parseInt(right.charAt(len - 1));

        if (9 === finalDigit) {
            return (
                propagateCarryFromRight(
                    left + "." + right.substring(0, len - 1)
                ) + "0"
            );
        }

        return (
            left +
            "." +
            right.substring(0, len - 1) +
            `${parseInt(right.charAt(len - 1)) + 1}`
        );
    }
}

function roundIt(
    isNegative: boolean,
    digitToRound: Digit,
    decidingDigit: Digit,
    roundingMode: RoundingMode
): DigitOrTen {
    switch (roundingMode) {
        case ROUNDING_MODE_CEILING:
            if (isNegative) {
                return digitToRound;
            }

            return (digitToRound + 1) as DigitOrTen;
        case ROUNDING_MODE_FLOOR:
            if (isNegative) {
                return (digitToRound + 1) as DigitOrTen;
            }

            return digitToRound;
        case ROUNDING_MODE_EXPAND:
            return (digitToRound + 1) as DigitOrTen;
        case ROUNDING_MODE_TRUNCATE:
            return digitToRound;
        case ROUNDING_MODE_HALF_CEILING:
            if (decidingDigit >= 5) {
                if (isNegative) {
                    return digitToRound;
                }

                return (digitToRound + 1) as DigitOrTen;
            }

            return digitToRound;
        case ROUNDING_MODE_HALF_FLOOR:
            if (decidingDigit === 5) {
                if (isNegative) {
                    return (digitToRound + 1) as DigitOrTen;
                }

                return digitToRound;
            }

            if (decidingDigit > 5) {
                return (digitToRound + 1) as DigitOrTen;
            }

            return digitToRound;
        case ROUNDING_MODE_HALF_TRUNCATE:
            if (decidingDigit === 5) {
                return digitToRound;
            }

            if (decidingDigit > 5) {
                return (digitToRound + 1) as DigitOrTen;
            }

            return digitToRound;
        case ROUNDING_MODE_HALF_EXPAND:
            if (decidingDigit >= 5) {
                return (digitToRound + 1) as DigitOrTen;
            }

            return digitToRound;
        case ROUNDING_MODE_HALF_EVEN:
            if (decidingDigit === 5) {
                if (digitToRound % 2 === 0) {
                    return digitToRound;
                }

                return (digitToRound + 1) as DigitOrTen;
            }

            if (decidingDigit > 5) {
                return (digitToRound + 1) as DigitOrTen;
            }

            return digitToRound;
        default:
            throw new Error(`Unknown rounding mode: ${roundingMode}`);
    }
}

export class DigitString {
    public readonly lhs: Array<Digit>;
    public readonly rhs: Array<Digit>;

    constructor(lhs: string, rhs: string) {
        this.lhs = explodeDigits(lhs);
        this.rhs = explodeDigits(rhs);
    }

    public toString(): string {
        let renderedLhs = this.lhs.join("");
        let renderedRhs = this.rhs.join("");

        if ("" === renderedLhs) {
            return "0." + renderedRhs;
        }

        return renderedLhs + "." + renderedRhs;
    }

    public round(finalDigit: Digit, mode: RoundingMode): DigitString {
        let [lhs, rhs] = this.toString().split(".");
        let newRhs = rhs + "0";
        let newFinalDigit = roundIt(
            false,
            finalDigit,
            parseInt(newRhs.charAt(0)) as Digit,
            mode
        );
        return new DigitString(lhs, newRhs.substring(1) + `${newFinalDigit}`);
    }

    public significand(): Array<Digit> {
        return this.lhs.concat(this.rhs);
    }

    public exponent(): number {
        return this.lhs.length;
    }

    public countSignificantDigits(): number {
        return this.lhs.length + this.rhs.length;
    }

    private isPowerOfTen(): boolean {
        return 1 === this.lhs.length && 1 === this.lhs[0];
    }

    public toRational(): Rational {
        let exp = this.exponent();
        let sig = BigInt(this.significand().join(""));
        if (this.isPowerOfTen()) {
            if (exp < 0) {
                return new Rational(1n, BigInt("1" + "0".repeat(0 - exp)));
            }

            if (exp == 0) {
                return new Rational(sig, 1n);
            }

            return new Rational(BigInt("1" + "0".repeat(exp)), 1n);
        }

        if (exp < 0) {
            return new Rational(sig, 1n ** BigInt(0 - exp));
        }

        if (exp == 1) {
            return new Rational(BigInt(sig + "0"), 1n);
        }

        if (sig === 0n) {
            return new Rational(0n, 1n);
        }

        return new Rational(sig, 10n ** BigInt(exp));
    }

    public isInteger(): boolean {
        return this.exponent() >= 0;
    }
}
