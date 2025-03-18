// mainwindow.cpp
#include "mainwindow.h"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QListView>
#include "../models/diffmodel.h"
#include "../models/chatmodel.h" // Include the ChatModel
#include <QDebug>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    setupUI();
}

MainWindow::~MainWindow() {}

void MainWindow::setupUI()
{
    // --- Main Window Setup ---
    this->setWindowTitle("LLM Chat Interface");
    this->resize(1024, 768);

    // --- Main Splitter (Left and Right Halves) ---
    mainSplitter = new QSplitter(Qt::Horizontal, this);

    // --- Chat Interface ---
    chatInterface = new ChatInterface(this);
    ChatModel* chatModel = new ChatModel(this);  // Create the ChatModel

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

    // --- Placeholder Chat Data ---  <--  ADD THIS SECTION
    populatePlaceholderChatData(chatModel);
    chatInterface->setModel(chatModel);     // Connect to the model
}

// --- Placeholder Chat Data Function ---  <--  ADD THIS FUNCTION
void MainWindow::populatePlaceholderChatData(ChatModel* chatModel) {
    if (!chatModel) return; // Safety check

    chatModel->addMessage(ChatModel::User, "What is the capital of France?");
    chatModel->addMessage(ChatModel::LLM, "The capital of France is Paris.");
    chatModel->addMessage(ChatModel::User, "Can you write a Python function to calculate the factorial of a number?");
    chatModel->addMessage(ChatModel::LLM, "`python\ndef factorial(n):\n  if n == 0:\n    return 1\n  else:\n    return n * factorial(n-1)\n`");
    chatModel->addMessage(ChatModel::User, "Explain how a binary search tree works.");
    chatModel->addMessage(ChatModel::LLM, "A binary search tree (BST) is a tree data structure in which each node has at most two children, which are referred to as the left child and the right child.  In a BST, the value of all the nodes in the left subtree of a node are less than the node's value, and all the nodes in the right subtree have values greater than the node's value. This property allows for efficient searching, insertion, and deletion of nodes.  The average time complexity for search, insert, and delete operations is O(log n), where n is the number of nodes.  However, in the worst case (e.g., a skewed tree), these operations can take O(n) time.");
    chatModel->addMessage(ChatModel::User, "Thank You");
    chatModel->addMessage(ChatModel::LLM, "You are welcome!");

}