export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export const notFound = (code = "NOT_FOUND", message = "요청한 데이터를 찾을 수 없습니다.") =>
  new ApiError(code, message, 404);

