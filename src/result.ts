/**
 * @fileoverview Defines a Result type that can represent either a successful value or an error. 
 * This is useful for functions that may fail and need to return an error message or object instead 
 * of throwing an exception.
 */

type Success<T> = {
    success: true;
    value: T;
};

type Failure<E> = {
    success: false;
    error: E;
};

export type Result<T, E> = Success<T> | Failure<E>;

/**
 * Utility function to create a success Result. 
 * @param value The value to include in the success Result, of type T.
 * @returns The success Result.
 */
export function success<T>(value: T): Result<T, never> {
    return { success: true, value };
}

/**
 * Utility function to create a failure Result. 
 * @param error The error value to include in the failure Result, usually of type Error or a string. 
 * @returns The failure Result.
 */
export function failure<E>(error: E): Result<never, E> {
    return { success: false, error };
}

/**
 * Utility function to convert an unknown error into a standardized Error object. If the input is 
 * already an Error, it returns it as is. If it's a string, it creates a new Error with that string
 * as the message. For any other type of input, it converts it to a string (using JSON.stringify if 
 * it's an object) and creates an Error with that string as the message.
 * @param possibleError The unknown error to convert into an Error object.
 * @returns The Error object.
 */
export function makeError(possibleError: unknown): Error {
    if (possibleError instanceof Error) {
        return possibleError;
    } else if (typeof possibleError === 'string') {
        return new Error(possibleError);
    } else {
        return new Error(JSON.stringify(possibleError));
    }
}

/**
 * Utility function to accumulate an array of Result<T, E> into a single Result<T[], string>. If any of the
 * results are failures, the function will return a failure with a concatenated error message. If all results
 * are successes, it will return a success with an array of the successful values.
 * @param results The array of Result<T, E> to accumulate.
 * @returns The accumulated Result<T[], string>
 */
export function accumulate<T, E>(results: Result<T, E>[]): Result<T[], string> {
    const values: T[] = [];
    const errors: string[] = [];

    for (const result of results) {
        if (result.success) {
            values.push(result.value);
        } else {
            result.error instanceof Error 
                ? errors.push(result.error.message) 
                : typeof result.error === 'string'
                    ? errors.push(result.error)
                    : errors.push(JSON.stringify(result.error));
        }
    }

    if (errors.length > 0) {
        return failure(errors.join('\n'));
    }

    return success(values);
}