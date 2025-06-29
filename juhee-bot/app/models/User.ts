import { Sequelize, DataTypes } from "sequelize";

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