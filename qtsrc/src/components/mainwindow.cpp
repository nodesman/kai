// mainwindow.cpp
#include "mainwindow.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QListView>
#include "../models/diffmodel.h"
#include "../models/chatmodel.h"
#include <QDebug>
#include <QTimer>
#include "chatinterface/chatinterface.h"
#include <QJsonObject>
#include <QJsonDocument>
#include <QJsonArray>
#include "diffviewer/diffview.h"
#include "../backend/communicationmanager.h" // Include the CommunicationManager header

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , communicationManager(new CommunicationManager(this)) // Initialize CommunicationManager
{
    setupUI();
    connect(communicationManager, &CommunicationManager::requestStatusChanged, this, &MainWindow::handleRequestPendingChanged);
    connect(communicationManager, &CommunicationManager::errorReceived, this, &MainWindow::handleErrorReceived);
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
    chatModel = new ChatModel(this);

    mainSplitter->addWidget(chatInterface);

    // --- Diff View and Model ---
    diffView = new DiffView(this);
    diffModel = new DiffModel(this);
    diffView->setModel(diffModel);
    mainSplitter->addWidget(diffView);

    mainSplitter->setStretchFactor(0, 60);
    mainSplitter->setStretchFactor(1, 40);

    // --- Set Central Widget ---
    this->setCentralWidget(mainSplitter);

    // --- Placeholder Chat Data ---
    populatePlaceholderChatData();
    chatInterface->setModel(chatModel);
    connect(chatInterface, &ChatInterface::sendMessage, communicationManager, &CommunicationManager::sendChatMessage); // Connect to CommunicationManager
}

void MainWindow::populatePlaceholderChatData() {
    if (!chatModel) return;
}


void MainWindow::handleRequestPendingChanged(bool pending) {
    if (chatModel) {
        chatModel->setRequestPending(pending);
    }
}

void MainWindow::handleErrorReceived(const QString &errorMessage) {
    qWarning() << "Error from Node:" << errorMessage;
    if (chatModel) {
        chatModel->addMessage(ChatModel::LLM, "Error: " + errorMessage);
    }
}