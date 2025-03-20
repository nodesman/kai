// src/components/mainwindow.cpp

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
}

MainWindow::~MainWindow()
{
}

void MainWindow::setupUI() {
    // --- Main Window Setup ---
    this->setWindowTitle("LLM Chat Interface");
    this->resize(1024, 768);

    // --- Main Splitter ---
    mainSplitter = new QSplitter(Qt::Horizontal, this);

    // --- Chat Interface ---
    chatInterface = new ChatInterface(this);
    chatModel = new ChatModel(this);
    chatInterface->setModel(chatModel);
    mainSplitter->addWidget(chatInterface);

    // --- Diff View and Model ---
    diffModel = new DiffModel(this);
    diffView = new DiffView(this, diffModel);
    mainSplitter->addWidget(diffView);

    mainSplitter->setStretchFactor(0, 60);
    mainSplitter->setStretchFactor(1, 40);

    communicationManager = new CommunicationManager(this, diffModel, chatModel);

    // --- Set Central Widget ---
    this->setCentralWidget(mainSplitter);

    connect(chatInterface, &ChatInterface::sendMessage, communicationManager, &CommunicationManager::sendChatMessage);
    connect(communicationManager, &CommunicationManager::chatMessageReceived, chatInterface, &ChatInterface::updateChatHistory);
    connect(communicationManager, &CommunicationManager::requestStatusChanged, chatInterface, &ChatInterface::handleRequestPendingChanged);

    // Connect the serverReady signal
    connect(communicationManager, &CommunicationManager::serverReady, this, &MainWindow::onServerReady);
}

void MainWindow::onServerReady() {
    qDebug() << "Server is now ready to accept connections!";
}