/**
 * @fileoverview 데이터베이스 객체 관계 정의
 * @description Sequelize를 사용한 데이터베이스 모델 및 관계 설정
 * @author kevin1113dev
 */

import { Sequelize } from 'sequelize';

/**
 * Sequelize 인스턴스
 * SQLite 데이터베이스 사용
 */
const sequelize = new Sequelize('database', 'username', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: false,
	storage: 'database.sqlite',
});

import module_Users from './models/User.js';
import module_Servers from './models/Server.js';
import module_JoinedServer from './models/JoinedServer.js';

/** 사용자 모델 */
const Users = module_Users(sequelize);

/** 서버 모델 */
const Servers = module_Servers(sequelize);

/** 서버-사용자 관계 모델 */
const JoinedServer = module_JoinedServer(sequelize);

/**
 * 데이터베이스 관계 설정
 * 
 * @remarks
 * - 서버는 여러 사용자와 N:M 관계
 * - 사용자는 여러 서버와 N:M 관계
 * - JoinedServer는 중간 테이블
 * - CASCADE 삭제 설정
 */
Servers.belongsToMany(Users, { through: JoinedServer, foreignKey: 'server_id', sourceKey: 'id', onDelete: 'CASCADE' });
Users.belongsToMany(Servers, { through: JoinedServer, foreignKey: 'user_id', sourceKey: 'id', onDelete: 'CASCADE' });
JoinedServer.belongsTo(Servers, { foreignKey: 'server_id', targetKey: 'id' });
JoinedServer.belongsTo(Users, { foreignKey: 'user_id', targetKey: 'id' });

export { Users, Servers, JoinedServer };