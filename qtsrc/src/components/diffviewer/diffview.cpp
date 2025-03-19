#include "diffview.h"
#include "diffcontentwidget.h"
#include "../../models/diffmodel.h"
#include <QPainter>
#include <QVBoxLayout>
#include <QMouseEvent>
#include <QListView>
#include <QSplitter>
#include <QWheelEvent>
#include <QScrollArea>
#include <QFontMetrics>
#include <QPalette>
#include <QDebug>

DiffView::DiffView(QWidget *parent, DiffModel *model) // Add model parameter
    : QWidget(parent)
    , m_model(nullptr) // Initialize to nullptr
    , m_fileListView(new QListView(this))
    , m_scrollArea(new QScrollArea(this))
    , m_lineHeight(0)
    , m_currentIndex()
{
    setFocusPolicy(Qt::StrongFocus);

    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    QSplitter *splitter = new QSplitter(Qt::Vertical, this);
    mainLayout->addWidget(splitter);

    splitter->addWidget(m_fileListView);

    m_scrollArea->setWidgetResizable(true);
    m_scrollArea->setHorizontalScrollBarPolicy(Qt::ScrollBarAsNeeded);
    m_scrollArea->setVerticalScrollBarPolicy(Qt::ScrollBarAsNeeded);

    QPalette palette = m_scrollArea->palette();
    palette.setColor(QPalette::Window, Qt::white);
    m_scrollArea->setPalette(palette);
    m_scrollArea->setAutoFillBackground(true);

    splitter->addWidget(m_scrollArea);

    m_diffContent.reset(new DiffContentWidget(m_scrollArea));
    m_scrollArea->setWidget(m_diffContent.data());

    setLayout(mainLayout);

    connect(m_fileListView, &QListView::clicked, this, &DiffView::onFileSelectionChanged);

    // Set the model *after* creating the UI elements (important!)
    setModel(model); // Use setModel to handle connections
}

DiffView::~DiffView() {}

void DiffView::setModel(DiffModel *model) {
    // Disconnect from the old model, if any
    if (m_model) {
        disconnect(m_model, &DiffModel::dataChanged, this, &DiffView::onDataChanged);
        disconnect(m_model, &DiffModel::modelReset, this, &DiffView::updateDiffContent);
        disconnect(m_model, &DiffModel::modelReset, this, &DiffView::modelWasReset);
    }

    m_model = model;

    if (m_fileListView) {
        m_fileListView->setModel(m_model);
    }

    // Connect to the *new* model's signals
    if (m_model) {
        connect(m_model, &DiffModel::dataChanged, this, &DiffView::onDataChanged);
        connect(m_model, &DiffModel::modelReset, this, &DiffView::updateDiffContent);
        connect(m_model, &DiffModel::modelReset, this, &DiffView::modelWasReset);

        // Initial update (if there's data) and selection
        if (m_model->rowCount() > 0) {
             //This part is corrected
              m_fileListView->setCurrentIndex(m_model->index(0, 0));
              onFileSelectionChanged(m_model->index(0,0)); // Call to load first
        } else {
             m_diffContent->setDiffData({}, "");
        }
    }
    else{ //If set to null
        m_diffContent->setDiffData({}, ""); // Clear content
        if (m_fileListView) {
            m_fileListView->setModel(nullptr); //No model
        }
    }
}
void DiffView::modelWasReset()
{
    //If the model is reset, select the 0,0 index, if possible.
    if (m_model && m_model->rowCount() > 0) {
        m_fileListView->setCurrentIndex(m_model->index(0, 0));
        onFileSelectionChanged(m_model->index(0,0)); //Update display
    } else {
        m_diffContent->setDiffData({}, ""); //Clear diff
    }

}

void DiffView::updateDiffContent(){
    //This function should get the currently selected file index,
    //retrieve data, and update diff.
    onFileSelectionChanged(m_fileListView->currentIndex()); // Correct way to update
}

void DiffView::onFileSelectionChanged(const QModelIndex &index) {
   m_currentIndex = index; //Update current index

    if (!index.isValid() || !m_model) {
        m_diffContent->setDiffData({}, ""); // Clear content if invalid index or no model
        return;
    }

    // Get file path and content from the model
    QString filePath = m_model->getFilePath(index.row());
    QString fileContent = m_model->getFileContent(index.row());

    // Parse the content and set the data in the DiffContentWidget
    QList<DiffLine> diffLines = parseDiffContent(fileContent);
    m_diffContent->setDiffData(diffLines, filePath);
}

void DiffView::onDataChanged(const QModelIndex &topLeft, const QModelIndex &bottomRight, const QVector<int> &roles)
{
    Q_UNUSED(bottomRight);
    // Check if the changed index is the currently selected one
    if (m_fileListView->currentIndex() == topLeft && roles.contains(DiffModel::FileContentRole)) {
        updateDiffContent(); // Use the corrected updateDiffContent
    }
}

QList<DiffView::DiffLine> DiffView::parseDiffContent(const QString& content) {
    QList<DiffView::DiffLine> diffData;
    QStringList lines = content.split('\n');

    for (const QString& line : lines) {
        DiffLine diffLine;

        if (line.startsWith('+')) {
            diffLine.changeType = DiffLine::Added;
            diffLine.text = line.mid(1);
        } else if (line.startsWith('-')) {
            diffLine.changeType = DiffLine::Removed;
            diffLine.text = line.mid(1);
        } else {
            diffLine.changeType = DiffLine::Unchanged;
            diffLine.text = line;
        }

        diffData.append(diffLine);
    }

    return diffData;
}

void DiffView::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::RightButton) {
        emit requestDiffExplanation();
    }
    QWidget::mousePressEvent(event);
}