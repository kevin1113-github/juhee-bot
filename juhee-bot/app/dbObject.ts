
// DB 객체관계 정의 코드

import { Sequelize, DataTypes } from 'sequelize';

const sequelize = new Sequelize('database', 'username', 'password', {
	host: 'localhost',
	dialect: 'sqlite',
	logging: false,
	storage: 'database.sqlite',
});

import module_Users from './models/User.js';
import module_Servers from './models/Server.js';
import module_JoinedServer from './models/JoinedServer.js';

const Users = module_Users(sequelize, DataTypes);
const Servers = module_Servers(sequelize, DataTypes);
const JoinedServer = module_JoinedServer(sequelize, DataTypes);

// 서버는 여러 유저에게 속해있다.
Servers.belongsToMany(Users, { through: JoinedServer, foreignKey: 'server_id', sourceKey: 'id', onDelete: 'CASCADE' });
// 유저는 여러 서버에 속해있다.
Users.belongsToMany(Servers, { through: JoinedServer, foreignKey: 'user_id', sourceKey: 'id', onDelete: 'CASCADE' });
// 서버-유저 관계는 서버에서 하나 유저에서 하나씩 속해있다.
JoinedServer.belongsTo(Servers, { foreignKey: 'server_id', targetKey: 'id' });
JoinedServer.belongsTo(Users, { foreignKey: 'user_id', targetKey: 'id' });

export { Users, Servers, JoinedServer };