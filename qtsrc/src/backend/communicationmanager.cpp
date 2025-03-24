// communicationmanager.cpp
#include "communicationmanager.h"
#include <QDebug>
#include <QJsonObject>
#include <QJsonDocument>
#include <QWebSocket>
#include <QUrl>
#include <QTimer>
#include <QJsonArray>
#include <QAbstractSocket>

// Define the Private class *OUTSIDE* of CommunicationManager
class CommunicationManagerPrivate {
public:
    CommunicationManagerPrivate() : webSocket(new QWebSocket()) {} // Initialize in constructor
    ~CommunicationManagerPrivate() { delete webSocket; } // Clean up in destructor

    QWebSocket *webSocket;
    QUrl serverUrl;
};

CommunicationManager::CommunicationManager(QObject *parent, DiffModel *diffModel, ChatModel *chatModel)
    : QObject(parent)
    , m_chatModel(chatModel)
    , m_diffModel(diffModel)
    , d(new CommunicationManagerPrivate) // Use the correct type here
{
    // Connect signals for chat and diff interaction
    connect(this, &CommunicationManager::chatMessageReceived,
            [this](const QString &message, int messageType) {
        m_chatModel->addMessage(message, static_cast<ChatModel::MessageType>(messageType));
    });
    connect(this, &CommunicationManager::requestStatusChanged, m_chatModel, &ChatModel::setRequestPending);
    connect(this, &CommunicationManager::diffResultReceived, m_diffModel, &DiffModel::setFiles);
    connect(this, &CommunicationManager::diffApplied, m_diffModel, &DiffModel::clearDiffModel);
    connect(this, &CommunicationManager::ready, this, &CommunicationManager::sendReadySignal);

    // --- WebSocket Setup ---
    d->serverUrl = QUrl("ws://localhost:8080");

    // Connect signals *using d->webSocket*
    connect(d->webSocket, &QWebSocket::connected, this, &CommunicationManager::onConnected);
    connect(d->webSocket, &QWebSocket::disconnected, this, &CommunicationManager::onDisconnected);
    connect(d->webSocket, &QWebSocket::textMessageReceived, this, &CommunicationManager::onTextMessageReceived);
    connect(d->webSocket, QOverload<QAbstractSocket::SocketError>::of(&QWebSocket::errorOccurred),
           this, &CommunicationManager::onError);


    d->webSocket->open(d->serverUrl);

    QTimer::singleShot(0, this, &CommunicationManager::ready);
}

CommunicationManager::~CommunicationManager() {
    if (d->webSocket->state() == QAbstractSocket::ConnectedState) {
        d->webSocket->close();  // Close the connection
    }
    delete d; // Delete the private data (VERY IMPORTANT!)
}

void CommunicationManager::sendReadySignal() {
    if (d->webSocket->state() == QAbstractSocket::ConnectedState) {
        QJsonObject readyMessage;
        readyMessage["type"] = "ready";
        sendJson(readyMessage);
    }
}

void CommunicationManager::onConnected() {
    qDebug() << "WebSocket connected to:" << d->serverUrl;
}

void CommunicationManager::onDisconnected() {
    qDebug() << "WebSocket disconnected";
    QTimer::singleShot(5000, this, [this](){
        qDebug() << "Attempting to reconnect...";
        d->webSocket->open(d->serverUrl);
    });
}

void CommunicationManager::onTextMessageReceived(const QString &message) {
    qDebug() << "Message received:" << message;
    QJsonParseError error;
    QJsonDocument doc = QJsonDocument::fromJson(message.toUtf8(), &error);
    if (error.error != QJsonParseError::NoError) {
        emit errorReceived("JSON Parse Error: " + error.errorString());
        return;
    }
    if (doc.isObject()) {
        processReceivedJson(doc.object());
    } else {
        emit errorReceived("Received data is not a JSON object.");
    }
}

void CommunicationManager::onError(QAbstractSocket::SocketError error) {
    qDebug() << "WebSocket error:" << d->webSocket->errorString();
}

void CommunicationManager::sendJson(const QJsonObject &obj) {
    if (d->webSocket->state() == QAbstractSocket::ConnectedState) {
        d->webSocket->sendTextMessage(QJsonDocument(obj).toJson(QJsonDocument::Compact));
        qDebug() << "Sent JSON:" << QJsonDocument(obj).toJson();
    } else {
        qDebug() << "WebSocket not connected.  Cannot send JSON.";
    }
}
void CommunicationManager::processReceivedJson(const QJsonObject &obj) {
     qDebug() << "Entering processReceivedJson.  Received object: " << obj;

    if (obj["type"] == "chatMessage") {
         qDebug() << "  Processing chatMessage";
        if (obj.contains("messageType") && obj["messageType"].isString() &&
            obj.contains("text") && obj["text"].isString()) {

            QString messageTypeStr = obj["messageType"].toString();
            ChatModel::MessageType messageType;

            if (messageTypeStr == "User") {
                messageType = ChatModel::User;
            } else if (messageTypeStr == "LLM") {
                messageType = ChatModel::LLM;
            } else {
                 qDebug() << "    Invalid messageType: " << messageTypeStr;
                emit errorReceived("Invalid messageType in chatMessage");
                return;
            }

             qDebug() << "    Emitting chatMessageReceived.  Message: " << obj["text"].toString() << ", Type: " << messageTypeStr;
            emit chatMessageReceived(obj["text"].toString(), messageType);

        } else {
             qDebug() << "    Invalid chatMessage format.";
            emit errorReceived("Invalid chatMessage format.");
        }
    } else if (obj["type"] == "requestStatus") {
         qDebug() << "  Processing requestStatus";
        if (obj.contains("status") && obj["status"].isBool()) {
             qDebug() << "    Emitting requestStatusChanged: " << obj["status"].toBool();
            emit requestStatusChanged(obj["status"].toBool());

        } else {
             qDebug() << "    Invalid requestStatus format.";
            emit errorReceived("Invalid requestStatus format");
        }
    } else if (obj["type"] == "diffApplied") {
         qDebug() << "  Processing diffApplied";
        emit diffApplied();

    } else if (obj["type"] == "diffResult") {
         qDebug() << "  Processing diffResult";
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
                         qDebug() << "    Invalid file object in diffResult";
                        emit errorReceived("Invalid file object in diffResult");
                        return;
                    }
                } else {
                     qDebug() << "    Invalid element in files array (not an object)";
                    emit errorReceived("Invalid element in files array (not an object)");
                    return;
                }
            }
             qDebug() << "    Emitting diffResultReceived.  Paths: " << filePaths; // Log the paths
            emit diffResultReceived(filePaths, fileContents);

        } else {
             qDebug() << "    Invalid diffResult format.";
            emit errorReceived("Invalid diffResult format.");
        }
     } else if (obj["type"] == "ready") {
        //do nothing

    }

    else {
         qDebug() << "  Unknown message type: " << obj["type"];
    }

     qDebug() << "Exiting processReceivedJson";
}




void CommunicationManager::sendChatMessage(const QString &message) {
    sendJson({
        {"type", "chatMessage"},
        {"messageType", "User"},
        {"text", message}
    });
}

void CommunicationManager::applyChanges() { // Corrected name
    sendJson({{"type", "applyDiff"}}); // Corrected type
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