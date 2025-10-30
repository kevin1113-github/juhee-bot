/**
 * @fileoverview 서버-사용자 관계 모델
 * @description 사용자가 어떤 서버에 속하는지 관리하는 중간 테이블
 * @author kevin1113dev
 */

import { Sequelize, DataTypes } from "sequelize";

/**
 * JoinedServer 모델 정의
 * 
 * @param sequelize - Sequelize 인스턴스
 * @returns JoinedServer 모델
 * 
 * @remarks
 * - 서버와 사용자의 N:M 관계를 위한 중간 테이블
 * - 복합 기본 키 (server_id, user_id)
 * - timestamps 비활성화
 */
export default (sequelize: Sequelize) => {
	return sequelize.define('joined_server', {
		server_id: {
			type: DataTypes.STRING,
			primaryKey: true,
		},
		user_id: {
			type: DataTypes.STRING,
			primaryKey: true,
		},
	}, { timestamps: false });
};