import { timingSafeEqual } from "node:crypto";

/** Compares two strings without letting the time taken reveal how much of them matches. */
export const safeEquals = (value: string, expected: string) => {
	const valueBuffer = Buffer.from(value);
	const expectedBuffer = Buffer.from(expected);
	if (valueBuffer.length !== expectedBuffer.length) return false;
	return timingSafeEqual(valueBuffer, expectedBuffer);
};
