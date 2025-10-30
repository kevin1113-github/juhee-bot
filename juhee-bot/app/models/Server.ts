/**
 * @fileoverview 서버(길드) 모델
 * @description Discord 서버의 설정 정보 저장
 * @author kevin1113dev
 */

import { Sequelize, DataTypes } from "sequelize";

/**
 * Server 모델 정의
 * 
 * @param sequelize - Sequelize 인스턴스
 * @returns Server 모델
 * 
 * @remarks
 * - id: Discord 서버 ID
 * - ttsChannel: TTS가 활성화된 채널 ID
 * - isMuted: 봇 음소거 여부
 * - simultaneousPlayback: 동시재생 모드 (현재 비활성화)
 */
export default (sequelize: Sequelize) => {
	return sequelize.define('servers', {
		id: {
			type: DataTypes.STRING,
			primaryKey: true,
		},
    ttsChannel: {
      type: DataTypes.STRING,
      allowNull: true,
    },
		isMuted: {
			type: DataTypes.BOOLEAN,
			allowNull: false,
			defaultValue: false,
		},
		/**
		 * 동시재생 기능 (현재 비활성화)
		 * 여러 사람의 TTS를 동시에 믹싱하여 재생
		 */
		// simultaneousPlayback: {
		// 	type: DataTypes.BOOLEAN,
		// 	allowNull: false,
		// 	defaultValue: true,
		// }
	});
};