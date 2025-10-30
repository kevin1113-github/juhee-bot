/**
 * @fileoverview 사용자 모델
 * @description Discord 사용자의 TTS 설정 정보 저장
 * @author kevin1113dev
 */

import { Sequelize, DataTypes } from "sequelize";

/**
 * User 모델 정의
 * 
 * @param sequelize - Sequelize 인스턴스
 * @returns User 모델
 * 
 * @remarks
 * - id: Discord 사용자 ID
 * - ttsVoice: 선호하는 TTS 음성
 * - speed: TTS 속도 (0-100)
 */
export default (sequelize: Sequelize) => {
  return sequelize.define('users', {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    ttsVoice: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    speed: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  });
};