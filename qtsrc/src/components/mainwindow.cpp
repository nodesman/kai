#include "mainwindow.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QListView>
#include "../models/diffmodel.h"
#include "diffviewer/diffview.h"
#include <QDebug>
#include <QTimer>
#include "chatinterface/chatinterface.h"
#include <QJsonObject>
#include <QJsonDocument>
#include <QJsonArray>
#include "../backend/communicationmanager.h"

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setupUI();
   // connect(communicationManager, &CommunicationManager::requestStatusChanged, this, &MainWindow::handleRequestPendingChanged);  No need to emit another signal. Chatmodel handles it.

}

MainWindow::~MainWindow()
{
}

void MainWindow::setupUI() {
    // --- Main Window Setup ---
    this->setWindowTitle("LLM Chat Interface");
    this->resize(1024, 768);  // A reasonable default size.

    // --- Main Splitter (Left and Right Halves) ---
     mainSplitter = new QSplitter(Qt::Horizontal, this);

    // --- Chat Interface ---
    chatInterface = new ChatInterface(this);
     chatModel = new ChatModel(this); // Create the chat model.  *IMPORTANT*
    chatInterface->setModel(chatModel);
    mainSplitter->addWidget(chatInterface); // Add chat interface FIRST.

    // --- Diff View and Model ---
    diffModel = new DiffModel(this);   // Create the diff model. *IMPORTANT*
    diffView = new DiffView(this, diffModel);  // Create the diff view
    mainSplitter->addWidget(diffView);

    mainSplitter->setStretchFactor(0, 60);  // 60% for chat
    mainSplitter->setStretchFactor(1, 40); // 40% for diff

    communicationManager = new CommunicationManager(this, diffModel, chatModel);

    // --- Set Central Widget ---
    this->setCentralWidget(mainSplitter);

     connect(chatInterface, &ChatInterface::sendMessage, communicationManager, &CommunicationManager::sendChatMessage);
     connect(communicationManager, &CommunicationManager::chatMessageReceived, chatInterface, &ChatInterface::updateChatHistory);
     connect(communicationManager, &CommunicationManager::requestStatusChanged, chatInterface, &ChatInterface::handleRequestPendingChanged); //Direct connection.

}