// mainwindow.cpp
#include "mainwindow.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QListView>
#include <QSplitter> // Corrected include
#include <QDebug>
#include <QTimer>
#include <QWidget> // Include QWidget

#include "diffviewer/diffview.h"

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setupUI();
    // connect(communicationManager, &CommunicationManager::requestStatusChanged, this, &MainWindow::handleRequestPendingChanged); // No longer needed
}

MainWindow::~MainWindow()
{
}

void MainWindow::setupUI() {
    // --- Main Window Setup ---
    this->setWindowTitle("LLM Chat Interface");
    this->resize(1024, 768);

    // --- Central Widget: A vertical layout ---
    QWidget *centralWidget = new QWidget(this);
    QVBoxLayout *mainLayout = new QVBoxLayout(centralWidget);
    mainLayout->setContentsMargins(0, 0, 0, 0); // Remove unnecessary margins
    mainLayout->setSpacing(0);


    // --- Main Splitter (Left and Right Halves) ---
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

    mainSplitter->setStretchFactor(0, 60);  // 60% for chat
    mainSplitter->setStretchFactor(1, 40); // 40% for diff


    // --- Button Layout (at the bottom) ---
    buttonLayout = new QHBoxLayout();
    buttonLayout->addStretch(); // Push buttons to the right

    applyButton = new QPushButton("Apply", this);
    resetButton = new QPushButton("Reset", this);

    buttonLayout->addWidget(applyButton);
    buttonLayout->addWidget(resetButton);

    // --- Add Splitter and Button Layout to Main Layout ---
    mainLayout->addWidget(mainSplitter);
    mainLayout->addLayout(buttonLayout); // Add the button layout

    // --- Set Central Widget ---
    this->setCentralWidget(centralWidget); // Set the central widget

    communicationManager = new CommunicationManager(this, diffModel, chatModel);


    connect(chatInterface, &ChatInterface::sendMessage, communicationManager, &CommunicationManager::sendChatMessage);
    connect(communicationManager, &CommunicationManager::chatMessageReceived, chatInterface, &ChatInterface::updateChatHistory);
    connect(communicationManager, &CommunicationManager::requestStatusChanged, chatInterface, &ChatInterface::handleRequestPendingChanged); //Direct connection.

    // Connect button signals
    connect(applyButton, &QPushButton::clicked, this, &MainWindow::applyDiff);
    connect(resetButton, &QPushButton::clicked, this, &MainWindow::resetDiff);
}

void MainWindow::applyDiff() {
    qDebug() << "Apply button clicked";
    communicationManager->applyChanges();
}

void MainWindow::resetDiff() {
    qDebug() << "Reset button clicked";
    // diffModel->clearDiffs();  // Clear diffs from the model
    // No need to call diffView->reset() anymore; DiffView is now connected.
}