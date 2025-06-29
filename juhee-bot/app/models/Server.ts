import { Sequelize, DataTypes } from "sequelize";

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
		// simultaneousPlayback: {
		// 	type: DataTypes.BOOLEAN,
		// 	allowNull: false,
		// 	defaultValue: true,
		// }
	});
};