#include "communicationmanager.h"
#include <QDebug>
#include <QJsonObject>
#include <QJsonDocument>
#include <QFile>
#include <QTextStream>
#include <QCoreApplication>

CommunicationManager::CommunicationManager(QObject *parent)
    : QObject(parent), m_stdinReader(":/stdin")
{
    connect(&m_stdinReader, &QFile::readyRead, this, &CommunicationManager::readFromStdin);

    m_chatModel = new ChatModel(this);
    m_diffModel = new DiffModel(this);

    // Connect signals *within* CommunicationManager (very important!)
    connect(this, &CommunicationManager::chatMessageReceived,
            [this](const QString &message, int messageType) {
                m_chatModel->addMessage(static_cast<ChatModel::MessageType>(messageType), message);
            });
    connect(this, &CommunicationManager::requestStatusChanged, m_chatModel, &ChatModel::setRequestPending);
    connect(this, &CommunicationManager::diffResultReceived, m_diffModel, &DiffModel::setFiles);
    connect(this, &CommunicationManager::diffApplied, m_diffModel, &DiffModel::clearDiffModel); // Clear diff on apply

    if (!m_stdinReader.open(QIODevice::ReadOnly | QIODevice::Text)) {
        qDebug() << "Error: Could not open stdin for reading.";
        emit errorReceived("Could not open stdin");
        return;
    }
}

void CommunicationManager::sendChatMessage(const QString &message) {
    sendJson({
        {"type", "chatMessage"},
        {"text", message}
    });
}

// Simplified: We just send a signal to apply the diff.
void CommunicationManager::applyDiff() {
    sendJson({{"type", "applyDiff"}});
}

void CommunicationManager::sendJson(const QJsonObject &obj) {
    QJsonDocument doc(obj);
    QByteArray jsonData = doc.toJson(QJsonDocument::Compact);
    QTextStream stream(stdout);
    stream << jsonData << Qt::endl;
    stream.flush();
}

void CommunicationManager::readFromStdin() {
    while (m_stdinReader.canReadLine()) {
        QByteArray data = m_stdinReader.readLine();
        QJsonParseError error;
        QJsonDocument doc = QJsonDocument::fromJson(data, &error);

        if (error.error != QJsonParseError::NoError) {
            qDebug() << "JSON parse error:" << error.errorString();
            emit errorReceived("JSON Parse Error: " + error.errorString());
            return;
        }

        if (doc.isObject()) {
            QJsonObject obj = doc.object();
            qDebug() << "Received JSON:" << obj;

            if (obj["type"] == "chatMessage") {
                if (obj.contains("messageType") && obj["messageType"].isString() &&
                    obj.contains("text") && obj["text"].isString()) {

                    QString messageTypeStr = obj["messageType"].toString();
                    ChatModel::MessageType messageType;

                    if (messageTypeStr == "User") {
                        messageType = ChatModel::User;
                    } else if (messageTypeStr == "LLM") {
                        messageType = ChatModel::LLM;
                    } else {
                        emit errorReceived("Invalid messageType in chatMessage");
                        return;
                    }
                    emit chatMessageReceived(obj["text"].toString(), messageType);
                } else {
                    emit errorReceived("Invalid chatMessage format.");
                }
            } else if (obj["type"] == "requestStatus") { // Renamed type
                if (obj.contains("status") && obj["status"].isBool()) { // Renamed field
                    emit requestStatusChanged(obj["status"].toBool()); // Renamed signal
                } else {
                    emit errorReceived("Invalid requestStatus format");
                }
            } else if (obj["type"] == "diffApplied") {
                // No data needed, just the signal
                emit diffApplied();
            }
             else if (obj["type"] == "diffResult") {
                if (obj.contains("files") && obj["files"].isArray()) {
                    QJsonArray filesArray = obj["files"].toArray();
                    QStringList filePaths;
                    QList<QString> fileContents;

                    for (const QJsonValue &fileVal : filesArray) {
                        if (fileVal.isObject()) {
                            QJsonObject fileObj = fileVal.toObject();
                            if (fileObj.contains("path") && fileObj["path"].isString() &&
                                fileObj.contains("content") && fileObj["content"].isString()) {
                                filePaths << fileObj["path"].toString();
                                fileContents << fileObj["content"].toString();
                            } else {
                                emit errorReceived("Invalid file object in diffResult");
                                return;
                            }
                        } else {
                            emit errorReceived("Invalid element in files array (not an object)");
                            return;
                        }
                    }
                    emit diffResultReceived(filePaths, fileContents);

                } else {
                    emit errorReceived("Invalid diffResult format.");
                }
            } else {
                qDebug() << "Unknown message type:" << obj["type"];
                emit errorReceived("Unknown message type: " + obj["type"].toString());
            }
        } else {
            qDebug() << "Received data is not a JSON object.";
            emit errorReceived("Received data is not a JSON object.");
        }
    }
}