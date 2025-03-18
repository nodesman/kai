// diffview.cpp
#include "diffview.h"
#include "../models/diffmodel.h" // Include the model header
#include <QPainter>
#include <QTextLayout>
#include <QScrollBar>
#include <QScrollArea>
#include <QVBoxLayout>
#include <QMouseEvent>
#include <QLabel>
#include <QListView>
#include <QSplitter> // Include QSplitter

DiffView::DiffView(QWidget *parent)
    : QWidget(parent), m_model(nullptr)
{
    // --- Layout Setup (using QSplitter) ---
    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    QSplitter *splitter = new QSplitter(Qt::Vertical, this); // Vertical splitter
    mainLayout->addWidget(splitter);

    // --- File List (QListView) ---
    QListView *fileListView = new QListView(this);
    splitter->addWidget(fileListView); // Add to splitter

    // --- Scroll Area for Diff Content ---
    QScrollArea *scrollArea = new QScrollArea(this);
    scrollArea->setWidgetResizable(true);
    QWidget *scrollContent = new QWidget(scrollArea); // Widget inside scroll area
    scrollArea->setWidget(scrollContent);
    QVBoxLayout *scrollLayout = new QVBoxLayout(scrollContent); // Layout for content
    scrollContent->setLayout(scrollLayout);

    splitter->addWidget(scrollArea); // Add scroll area to splitter

	//Make sure you can't resize the file list
    splitter->setStretchFactor(0, 0);
    splitter->setStretchFactor(1, 1); //diff view should be able to stretch.

    // --- Connect File List Selection ---
    connect(fileListView->selectionModel(), &QItemSelectionModel::currentRowChanged,
        this, [this, scrollLayout, scrollArea](const QModelIndex &current, const QModelIndex &previous) {
            Q_UNUSED(previous);
            if (m_model) {
                // Clear existing widgets from the scrollLayout
                QLayoutItem *child;
                while ((child = scrollLayout->takeAt(0)) != nullptr) {
                    delete child->widget(); // Delete the widget
                    delete child; // Delete the layout item
                }


                // Get the diff content for the selected file
                QString fileContent = m_model->getFileContent(current.row());
                QList<DiffLine> diffData = this->parseDiffContent(fileContent);

                // Create a QLabel to display the content
                QLabel *contentLabel = new QLabel(scrollArea);
                contentLabel->setTextFormat(Qt::PlainText); // Treat content as plain text
                contentLabel->setTextInteractionFlags(Qt::TextSelectableByMouse); // Make it selectable
                contentLabel->setWordWrap(false);       // Important: Don't wrap lines
                contentLabel->setFont(QFont("Courier New", 10)); // Use a monospaced font
                 // Set the  content on the label

                QPalette pal = contentLabel->palette();

                QString displayText;

                for(const DiffLine &line : diffData){
                    QString color = "";
                    if(line.changeType == Added){
                        color = "green";
                    } else if(line.changeType == Removed){
                        color = "red";
                    }
                    if(color.length() > 0){
                        displayText += QString("<font color = \"%1\">%2</font>").arg(color, line.text);
                    } else {
                        displayText += line.text;
                    }
                    displayText += "\n";
                }

                contentLabel->setText(displayText);
                scrollLayout->addWidget(contentLabel);
                scrollArea->verticalScrollBar()->setValue(0); //scroll to top

            }
        });
    setLayout(mainLayout);
}

DiffView::~DiffView() {} //destructor needed.

void DiffView::setDiffData(const QList<DiffLine>& diffData)
{
    m_diffData = diffData;
    update(); // Trigger a repaint
}

void DiffView::setModel(DiffModel *model) {
    m_model = model;
    QListView *fileListView = findChild<QListView *>(); // Find the QListView
    if (fileListView) {
        fileListView->setModel(m_model); // Set the model on the QListView
    }
}


QList<DiffView::DiffLine> DiffView::parseDiffContent(const QString& content) {
    QList<DiffLine> diffData; // Use the member variable
    diffData.clear(); // Clear previous data
    QStringList lines = content.split('\n');

    for (const QString& line : lines) {
        DiffLine diffLine;
        if (line.startsWith('+')) {
            diffLine.changeType = Added;
            diffLine.text = line.mid(1); // Remove the '+'
        } else if (line.startsWith('-')) {
            diffLine.changeType = Removed;
            diffLine.text = line.mid(1);  // Remove the '-'
        } else {
            diffLine.changeType = Unchanged;
            diffLine.text = line;
        }
        diffData.append(diffLine);
    }
    return diffData;
}


void DiffView::paintEvent(QPaintEvent *event)
{
    // We are not using the paint event.
    QWidget::paintEvent(event); // Call the base class implementation
}


QSize DiffView::sizeHint() const {
     return QSize(800, 600); // Return a preferred size.
}

QSize DiffView::minimumSizeHint() const
{
    return QSize(200, 100); // Set a reasonable minimum size
}