"use strict";
exports.__esModule = true;
exports["default"] = (function (sequelize, DataTypes) {
    return sequelize.define('users', {
        id: {
            type: DataTypes.STRING,
            primaryKey: true
        },
        ttsVoice: {
            type: DataTypes.STRING,
            allowNull: true
        },
        speed: {
            type: DataTypes.INTEGER,
            allowNull: true
        }
    });
});
