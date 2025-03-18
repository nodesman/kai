// COMMUNICATIONMANAGER_H
// communicationmanager.cpp
#include "communicationmanager.h"
#include <QDebug>
#include <QJsonObject>
#include <QJsonParseError>

CommunicationManager::CommunicationManager(QObject *parent) : QObject(parent), nodeProcess(new QProcess(this)) {
    // ... setup node process and connections ...
    connect(nodeProcess, &QProcess::readyReadStandardOutput, this, &CommunicationManager::processReadyReadStandardOutput);
}

void CommunicationManager::sendChatMessage(const QString &message) {
    QJsonObject obj;
    obj["type"] = "chatMessage";
    obj["text"] = message;
    sendJson(obj);
}

void CommunicationManager::applyChanges(const QJsonObject &changes) {
    QJsonObject obj;
    obj["type"] = "applyChanges";
    obj["changes"] = changes;
    sendJson(obj);
}

void CommunicationManager::sendJson(const QJsonObject &obj) {
    QJsonDocument doc(obj);
    QByteArray jsonData = doc.toJson(QJsonDocument::Compact);
    qDebug().noquote() << jsonData; // Write to stdout using qDebug
}

void CommunicationManager::processReadyReadStandardOutput(){
    // Read and emit data
}