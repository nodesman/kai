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

     // Connect a slot to simulate user input and LLM responses
    QTimer::singleShot(500, this, &MainWindow::simulateChatInteraction); // Start simulation after 500ms
}

// --- Placeholder Chat Data Function (Modified) ---
void MainWindow::populatePlaceholderChatData() { // No argument now
    if (!chatModel) return; // Safety check

    // We don't add initial messages here anymore.  They're added in the simulation.
}


void MainWindow::simulateChatInteraction()
{
    if (!chatModel) return; //Safety Check

    // Simulate user typing "What is the capital of France?"
    chatModel->addMessage(ChatModel::User, "What is the capital of France?");
    //Simulate LLM Response
    chatModel->setRequestPending(true);
    QTimer::singleShot(2000, this, [this]() { // Simulate a 2-second delay
        if(chatModel)
        {
            chatModel->addMessage(ChatModel::LLM, "The capital of France is Paris.");
            chatModel->setRequestPending(false);

             // Simulate the next user question after LLM responds.
            QTimer::singleShot(1000, this, [this]() {  //Another delay before next message
               if(chatModel){
                   chatModel->addMessage(ChatModel::User, "Can you write a Python function to calculate the factorial of a number?");
                   chatModel->setRequestPending(true);

                    QTimer::singleShot(3000, this, [this](){ // Simulate LLM processing.
                        if(chatModel) {
                            chatModel->addMessage(ChatModel::LLM, "`python\ndef factorial(n):\n  if n == 0:\n    return 1\n  else:\n    return n * factorial(n-1)\n`");
                            chatModel->setRequestPending(false);

                            //Simulate user saying "Thank you"
                            QTimer::singleShot(1000, this, [this]() {
                               if(chatModel) {
                                   chatModel->addMessage(ChatModel::User, "Thank you");
                                   chatModel->setRequestPending(true);
                                   // Simulate LLM response to thank you
                                   QTimer::singleShot(1500, this, [this](){
                                       if(chatModel) {
                                           chatModel->addMessage(ChatModel::LLM, "You are welcome!");
                                           chatModel->setRequestPending(false);
                                       }
                                   });
                               }
                            });
                        }
                    });
               }
            });
        }
    });
}