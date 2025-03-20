#include "communicationmanager.h"
#include <QDebug>
#include <QJsonObject>
#include <QJsonDocument>
#include <QJsonArray>
#include <QLocalSocket>
#include <QLocalServer>
#include <QCoreApplication>
#include <QTimer>
#include <QThread> // For QThread::msleep

CommunicationManager::CommunicationManager(QObject *parent, DiffModel *diffModel, ChatModel *chatModel)
    : QObject(parent)
    , m_chatModel(chatModel)
    , m_diffModel(diffModel)
    , m_server(new QLocalServer(this))
{
    // --- Remove the socket file if it exists (BEFORE listening) ---
    QLocalServer::removeServer("KaiDiffLocalSocket"); // This is crucial

    // --- Local Socket Setup (with retry) ---
    int retries = 10;
    int delayMs = 100; // 100ms delay
    bool listening = false;
    for (int i = 0; i < retries; ++i) {
        if (m_server->listen("KaiDiffLocalSocket")) {
            listening = true;
            break; // Success!
        }
        qWarning() << "Failed to start local server (attempt" << i + 1 << "):" << m_server->errorString();
        QThread::msleep(delayMs); // Wait before retrying
    }

    if (listening) {
        connect(m_server, &QLocalServer::newConnection, this, &CommunicationManager::handleNewConnection);
        qDebug() << "Local server listening on: KaiDiffLocalSocket";
        emit serverReady(); // Emit the signal - Server is ACTUALLY ready
    } else {
        qCritical() << "Failed to start local server after multiple retries. Exiting.";
        QCoreApplication::exit(1); // Exit the application.
    }
}

void CommunicationManager::handleNewConnection() {
    m_clientSocket = m_server->nextPendingConnection();
    if (!m_clientSocket) {
        qWarning() << "No pending connection found, despite newConnection signal.";
        return;
    }
    qDebug() << "Client connected!";
    connect(m_clientSocket, &QLocalSocket::readyRead, this, &CommunicationManager::readFromSocket);
    connect(m_clientSocket, &QLocalSocket::disconnected, this, &CommunicationManager::clientDisconnected);
    connect(m_clientSocket, &QLocalSocket::errorOccurred, this, &CommunicationManager::socketError);

    sendJson(QJsonObject({{"status", "connected"}, {"message", "Welcome to KaiDiff!"}}));
}

void CommunicationManager::readFromSocket() {

    if (!m_clientSocket) {
        qWarning() << "readFromSocket called, but m_clientSocket is null.";
        return;
    }

    while (m_clientSocket->canReadLine()) {
        QByteArray jsonData = m_clientSocket->readLine();
        QString line = QString::fromUtf8(jsonData.trimmed()); // Trim whitespace

         if (line.isEmpty()) continue;

        QJsonParseError error;
        QJsonDocument doc = QJsonDocument::fromJson(line.toUtf8(), &error);

        if (error.error != QJsonParseError::NoError) {
            qDebug() << "JSON parse error:" << error.errorString();
            sendJson(QJsonObject({{"error", "JSON Parse Error"}, {"details", error.errorString()}}));
            continue;
        }

        if (doc.isObject()) {
            QJsonObject obj = doc.object();
            qDebug() << "Received JSON:" << obj;
            processReceivedJson(obj); // Call processing function

        } else {
            qDebug() << "Received data is not a JSON object.";
            sendJson(QJsonObject({{"error", "Invalid JSON format"}, {"details", "Received data is not a JSON object."}}));
        }
    }
}

void CommunicationManager::clientDisconnected() {
    qDebug() << "Client disconnected.";
    if (m_clientSocket) {
        m_clientSocket->deleteLater(); // Clean up the socket
        m_clientSocket = nullptr;
    }
}

void CommunicationManager::socketError(QLocalSocket::LocalSocketError socketError)
{
    qCritical() << "Socket error:" << socketError << ":" << m_clientSocket->errorString();
    if(m_clientSocket){
         sendJson(QJsonObject({{"error", "Socket Error"}, {"details", m_clientSocket->errorString()}}));
    }

}

CommunicationManager::~CommunicationManager() {
    m_clientSocket->disconnectFromServer();
    m_clientSocket->deleteLater();
    m_server->close(); // Close the server
    m_server->deleteLater();
}

void CommunicationManager::sendChatMessage(const QString &message) {
   sendJson({
        {"type", "chatMessage"},
        {"text", message}
    });
}

void CommunicationManager::applyDiff() {
     sendJson({{"type", "applyDiff"}});
}

void CommunicationManager::sendJson(const QJsonObject &obj) {
   if (!m_clientSocket || m_clientSocket->state() != QLocalSocket::ConnectedState) {
        qWarning() << "Cannot send JSON, client socket not connected.";
        return;
    }

    QJsonDocument doc(obj);
    QByteArray jsonData = doc.toJson(QJsonDocument::Compact) + "\n"; // Add newline
    m_clientSocket->write(jsonData);
    if (!m_clientSocket->waitForBytesWritten()) { // Make sure data is sent
        qWarning() << "Failed to write all bytes to socket.";
    }
}

void CommunicationManager::processReceivedJson(const QJsonObject &obj) {
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
    } else if (obj["type"] == "requestStatus") {
        if (obj.contains("status") && obj["status"].isBool()) {
            emit requestStatusChanged(obj["status"].toBool());
        } else {
            emit errorReceived("Invalid requestStatus format");
        }
    } else if (obj["type"] == "diffApplied") {
        emit diffApplied();
    } else if (obj["type"] == "diffResult") {
        if (obj.contains("files") && obj["files"].isArray()) {
            QJsonArray filesArray = obj["files"].toArray();
            QStringList filePaths;
            QList<QString> fileContents;

            for (const QJsonValue &fileVal: filesArray) {
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
    }
      else if (obj.value("type").toString() == "quit") {
        qDebug() << "Received quit command. Closing connection";
        if (m_clientSocket)
        {
             m_clientSocket->disconnectFromServer();
        }

    }
     else {
        qDebug() << "Unknown message type:" << obj["type"];
    }
}

void CommunicationManager::initializeWithHardcodedData() {
    QTimer::singleShot(100, this, [this]() {
        m_chatModel->addMessage("Hello, this is a test message from the User.", ChatModel::User);
    });

    QTimer::singleShot(500, this, [this]() {
        m_chatModel->addMessage("And this is a response from the LLM.", ChatModel::LLM);
    });

    QTimer::singleShot(1000, this, [this]() {
        m_chatModel->addMessage("Another user message.", ChatModel::User);
    });

    QTimer::singleShot(1500, this, [this]() {
        m_chatModel->addMessage("Another LLM response.", ChatModel::LLM);
    });
    QTimer::singleShot(2000, this, [this]() {
        QStringList paths = {"file1.cpp", "file2.h", "long_file_name_example.txt"};
        QList<QString> contents = {
            "+Added line 1\n-Removed line 2\nUnchanged line 3",
            "Unchanged line 1\n+Added line 2",
            "-Removed line 1\n+Added very loooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong line"
        };
        m_diffModel->setFiles(paths, contents);

        qDebug() << "Initialized with hardcoded data.";
    });
}