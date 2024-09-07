"use strict";
exports.__esModule = true;
exports["default"] = (function (sequelize, DataTypes) {
    return sequelize.define('servers', {
        id: {
            type: DataTypes.STRING,
            primaryKey: true
        },
        ttsChannel: {
            type: DataTypes.STRING,
            allowNull: true
        },
        isMuted: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        }
    });
});
