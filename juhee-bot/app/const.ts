/**
 * @fileoverview 상수 및 경로 정의
 * @description ES 모듈에서 __dirname, __filename 사용을 위한 헬퍼
 * @author kevin1113dev
 */

import { fileURLToPath } from "url";

/** 현재 모듈의 디렉토리 경로 */
export const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** 현재 모듈의 파일 경로 */
export const __filename = fileURLToPath(import.meta.url);