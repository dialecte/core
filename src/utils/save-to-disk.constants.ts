/** What a save dialog throws when the user's gesture has lapsed: the save then goes through a download. */
export const LAPSED_GESTURE_ERRORS: readonly string[] = ['SecurityError', 'NotAllowedError']

/** What a handle's `remove` throws when the file is already gone: the discard is done. */
export const FILE_ALREADY_GONE_ERROR = 'NotFoundError'
