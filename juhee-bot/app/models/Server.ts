import { Sequelize } from "sequelize";

export default (sequelize: Sequelize, DataTypes: any) => {
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
		}
	});
};