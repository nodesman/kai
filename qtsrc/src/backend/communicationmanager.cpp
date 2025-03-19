// src/backend/communicationmanager.cpp
#include "communicationmanager.h"
#include <QDebug>
#include <QJsonObject>
#include <QJsonDocument>
#include <QFile>
#include <QTextStream>
#include <QCoreApplication>
#include <QFileInfo>
#include <QJsonArray>
#include <QStandardPaths> //For standard paths

CommunicationManager::CommunicationManager(QObject *parent, DiffModel *diffModel, ChatModel *chatModel)
    : QObject(parent),
      // Use a consistent, known location for the file.
      m_communicationFilePath(QStandardPaths::writableLocation(QStandardPaths::TempLocation) + "/communication_file.txt"),
      m_dataFile(m_communicationFilePath) // Initialize QFile with the path
{
    qDebug() << "Communication file path:" << m_communicationFilePath;

    m_chatModel = chatModel;
    m_diffModel = diffModel;

    connect(this, &CommunicationManager::chatMessageReceived,
            [this](const QString &message, int messageType) {
                m_chatModel->addMessage(message, static_cast<ChatModel::MessageType>(messageType));
            });
    connect(this, &CommunicationManager::requestStatusChanged, m_chatModel, &ChatModel::setRequestPending);
    connect(this, &CommunicationManager::diffResultReceived, m_diffModel, &DiffModel::setFiles);
    connect(this, &CommunicationManager::diffApplied, m_diffModel, &DiffModel::clearDiffModel);

    // Set up file watching (before potentially opening/creating)
    if (!m_fileWatcher.addPath(m_communicationFilePath)) {
        qDebug() << "Error: Could not watch file:" << m_communicationFilePath;
        emit errorReceived("Could not watch communication file");
        // Don't return; try to proceed anyway. The file might be created later.
    }
    // connect(&m_fileWatcher, &QFileSystemWatcher::fileChanged, this, &CommunicationManager::onFileChanged);

    // Initial read, in case the file exists with prior content.
    readFile();

    // --- Hardcoded Diff Data (for testing) ---
    QStringList filePaths;
    QList<QString> fileContents;

    filePaths << "file1.txt" << "file2.cpp";

    fileContents << R"(
-This is the original line.
+This is the modified line.
 This is an unchanged line.
-This line was removed.
+This line was added.
)" << R"(
 // file2.cpp
-#include <iostream>
+#include <cstdio>

 int main() {
-    std::cout << "Hello\n";
+    printf("Hello\n");
     return 0;
 }
)";

    emit diffResultReceived(filePaths, fileContents);
    // --- End Hardcoded Data ---
}

CommunicationManager::~CommunicationManager()
{
    if (m_fileWatcher.files().contains(m_communicationFilePath)){
        m_fileWatcher.removePath(m_communicationFilePath);
    }
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
    QJsonDocument doc(obj);
    QByteArray jsonData = doc.toJson(QJsonDocument::Compact);

    // Open and *truncate* the file for writing.  *Explicitly* specify the path.
    if (m_dataFile.open(QIODevice::WriteOnly | QIODevice::Text | QIODevice::Truncate)) {
        QTextStream out(&m_dataFile);
        out << jsonData << Qt::endl;
        m_dataFile.close(); // Close immediately after writing.
    } else {
        qDebug() << "Error opening file for writing:" << m_dataFile.errorString();
        emit errorReceived("Could not write to communication file: " + m_dataFile.errorString());
    }
}

void CommunicationManager::readFile() {
    // // Open the file for reading. *Explicitly* specify the path.
    // QFile file(m_communicationFilePath); // Create a *new* QFile object
    // if (!file.open(QIODevice::ReadOnly | QIODevice::Text)) {
    //     qDebug() << "File does not exist or cannot be opened for reading:" << m_communicationFilePath;
    //     // Don't emit an error or return here. The file might not exist yet.
    //     return; // Return if the file can't be opened
    // }
    //
    // QTextStream in(&file);
    // //Read all content even if it is multiple lines
    // while(!in.atEnd()){
    //     QString line = in.readLine();
    //     if (line.isEmpty()) continue; // Skip empty lines
    //
    //     QJsonParseError error;
    //     QJsonDocument doc = QJsonDocument::fromJson(line.toUtf8(), &error);
    //     if (error.error != QJsonParseError::NoError) {
    //         qDebug() << "JSON parse error:" << error.errorString();
    //         emit errorReceived("JSON Parse Error: " + error.errorString());
    //         continue; // Go to next line
    //     }
    //
    //     if (doc.isObject()) {
    //         QJsonObject obj = doc.object();
    //         qDebug() << "Received JSON:" << obj;
    //
    //         if (obj["type"] == "chatMessage") {
    //             if (obj.contains("messageType") && obj["messageType"].isString() &&
    //                 obj.contains("text") && obj["text"].isString()) {
    //
    //                 QString messageTypeStr = obj["messageType"].toString();
    //                 ChatModel::MessageType messageType;
    //
    //                 if (messageTypeStr == "User") {
    //                     messageType = ChatModel::User;
    //                 } else if (messageTypeStr == "LLM") {
    //                     messageType = ChatModel::LLM;
    //                 } else {
    //                     emit errorReceived("Invalid messageType in chatMessage");
    //                     continue; // Go to next line
    //                 }
    //                 emit chatMessageReceived(obj["text"].toString(), messageType);
    //             } else {
    //                 emit errorReceived("Invalid chatMessage format.");
    //             }
    //         } else if (obj["type"] == "requestStatus") {
    //             if (obj.contains("status") && obj["status"].isBool()) {
    //                 emit requestStatusChanged(obj["status"].toBool());
    //             } else {
    //                 emit errorReceived("Invalid requestStatus format");
    //             }
    //         } else if (obj["type"] == "diffApplied") {
    //             emit diffApplied();
    //         } else if (obj["type"] == "diffResult") {
    //             if (obj.contains("files") && obj["files"].isArray()) {
    //                 QJsonArray filesArray = obj["files"].toArray();
    //                 QStringList filePaths;
    //                 QList<QString> fileContents;
    //
    //                 for (const QJsonValue &fileVal : filesArray) {
    //                     if (fileVal.isObject()) {
    //                         QJsonObject fileObj = fileVal.toObject();
    //                         if (fileObj.contains("path") && fileObj["path"].isString() &&
    //                             fileObj.contains("content") && fileObj["content"].isString()) {
    //                             filePaths << fileObj["path"].toString();
    //                             fileContents << fileObj["content"].toString();
    //                         } else {
    //                             emit errorReceived("Invalid file object in diffResult");
    //                             continue;
    //                         }
    //                     } else {
    //                         emit errorReceived("Invalid element in files array (not an object)");
    //                         continue;
    //                     }
    //                 }
    //                 emit diffResultReceived(filePaths, fileContents);
    //
    //             } else {
    //                 emit errorReceived("Invalid diffResult format.");
    //             }
    //         } else {
    //             qDebug() << "Unknown message type:" << obj["type"];
    //             emit errorReceived("Unknown message type: " + obj["type"].toString());
    //         }
    //     } else {
    //         qDebug() << "Received data is not a JSON object.";
    //         emit errorReceived("Received data is not a JSON object.");
    //     }
    // }
    // file.close(); // Close the *local* QFile object.
}

void CommunicationManager::onFileChanged(const QString &path)
{
    Q_UNUSED(path);
    readFile();
}