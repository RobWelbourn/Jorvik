/**
 * @module result
 * Defines a Result type that can represent either a successful value or an error. 
 * This is useful for functions that may fail and need to return an error message or object instead 
 * of throwing an exception.
 */

/** Success result type */
type Success<T> = {
    success: true;
    value: T;
};

/** Failure result type */
type Failure<E> = {
    success: false;
    error: E;
};

/** Composite result type that can be either a success or a failure. */
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