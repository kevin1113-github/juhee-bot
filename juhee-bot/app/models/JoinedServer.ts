import { Sequelize, DataTypes } from "sequelize";

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