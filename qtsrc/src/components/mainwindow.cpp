// mainwindow.cpp
#include "mainwindow.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QListView>
#include "../models/diffmodel.h"
#include "../models/chatmodel.h" // Include the ChatModel
#include <QDebug>
#include <QTimer> // Include QTimer
#include "chatinterface/chatinterface.h"
#include <QJsonObject>
#include <QJsonDocument>
#include <QJsonArray>

#include "diffviewer/diffview.h"

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setupUI();
}

MainWindow::~MainWindow() {
}

void MainWindow::setupUI()
{
    // --- Main Window Setup ---
    this->setWindowTitle("LLM Chat Interface");
    this->resize(1024, 768);

    // --- Main Splitter (Left and Right Halves) ---
    mainSplitter = new QSplitter(Qt::Horizontal, this);

    // --- Chat Interface ---
    chatInterface = new ChatInterface(this);
    chatModel = new ChatModel(this);  // Create the ChatModel (make it a member variable)

    mainSplitter->addWidget(chatInterface);

    // --- Diff View and Model ---
    diffView = new DiffView(this);
    diffModel = new DiffModel(this); // Create the model
    diffView->setModel(diffModel);      // Connect the view to the model
    mainSplitter->addWidget(diffView);

    mainSplitter->setStretchFactor(0, 60);  // Chat interface takes 60%
    mainSplitter->setStretchFactor(1, 40); // Diff view takes 40%

    // --- Set Central Widget ---
    this->setCentralWidget(mainSplitter);

    // --- Placeholder Chat Data and Simulation ---
    populatePlaceholderChatData(); // Call without argument (we use the member variable)
    chatInterface->setModel(chatModel);     // Connect to the model
    connect(chatInterface, &ChatInterface::sendMessage, this, &MainWindow::sendPromptToNodeJs);


}

// --- Placeholder Chat Data Function (Modified) ---
void MainWindow::populatePlaceholderChatData() { // No argument now
    if (!chatModel) return; // Safety check
}


void MainWindow::sendPromptToNodeJs(const QString &prompt)
{
    // Construct a JSON object to send to Node.js
    QJsonObject obj;
    obj["type"] = "prompt";
    obj["text"] = prompt;

    QJsonDocument doc(obj);
    QByteArray jsonData = doc.toJson(QJsonDocument::Compact); // Compact format is good for communication

    // Write to standard output
    qDebug() << jsonData.toStdString();
}

void MainWindow::processReadyReadStandardOutput()
{
    // Read all available data from Node.js
    QByteArray data = qobject_cast<QProcess*>(sender())->readAllStandardOutput();
    QJsonParseError parseError;
    QJsonDocument doc = QJsonDocument::fromJson(data, &parseError);

    if (parseError.error != QJsonParseError::NoError) {
        qWarning() << "Failed to parse JSON from Node.js:" << parseError.errorString();
        return;
    }

    if (!doc.isObject()) {
        qWarning() << "Expected JSON object from Node.js, got:" << doc.toJson();
        return;
    }

    QJsonObject obj = doc.object();

    // Handle different types of messages from Node.js
    if (obj.contains("type")) {
        QString messageType = obj.value("type").toString();

        if (messageType == "response") {
            QString responseText = obj.value("text").toString();
             if(chatModel) {
                 chatModel->addMessage(ChatModel::LLM, responseText);
             }

        } else if (messageType == "requestPending") {
            bool pending = obj.value("pending").toBool();
            if(chatModel){
                chatModel->setRequestPending(pending);
            }
        } else if(messageType == "error") {
            //Handle Error messages
            QString errorMessage = obj["message"].toString();
            qWarning() << "Error from Node:" << errorMessage;
            // You might want to add this to the ChatModel as a special error message:
            // chatModel->addMessage(ChatModel::LLM, "Error: " + errorMessage);
        } else {
            qWarning() << "Unknown message type from Node.js:" << messageType;
        }
    } else {
        qWarning() << "Received JSON object without 'type' field from Node.js";
    }
}